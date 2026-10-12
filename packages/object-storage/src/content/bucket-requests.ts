import {
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from '@aws-sdk/client-s3';
import { verifiedStream, type StreamedContent } from '@beonauto/operations';

export interface Bucket {
  readonly client: () => S3Client;
  readonly name: string;
}

export interface Held {
  readonly bytes: number;
  readonly mediaType: string;
}

export interface OpenUpload {
  readonly key: string;
  readonly uploadId: string;
}

interface Listed {
  readonly Key?: string | undefined;
  readonly UploadId?: string | undefined;
}

interface ListedUpload {
  readonly key: string | undefined;
  readonly uploadId: string | undefined;
}

interface UploadMarkers {
  readonly KeyMarker: string | undefined;
  readonly UploadIdMarker: string | undefined;
}

const mostKeysInOneDelete = 1000;

const mostConditionalWrites = 3;

const octets = 'application/octet-stream';

const ifNoneMatch = '*';

const notFound = 404;

const anotherWroteFirst = 412;

const conditionalConflict = 409;

function statusOf(failure: unknown): number | undefined {
  return failure instanceof S3ServiceException ? failure.$metadata.httpStatusCode : undefined;
}

async function unlessNotFound<A>(request: Promise<A>): Promise<A | undefined> {
  try {
    return await request;
  } catch (failure) {
    if (statusOf(failure) === notFound) {
      return undefined;
    }
    throw failure;
  }
}

async function writtenIfFirst(write: () => Promise<unknown>, attempt = 1): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (failure) {
    const status = statusOf(failure);
    if (status === anotherWroteFirst) {
      return false;
    }
    if (status === conditionalConflict && attempt < mostConditionalWrites) {
      return writtenIfFirst(write, attempt + 1);
    }
    throw failure;
  }
}

function answeredWithout(key: string, missing: string): Error {
  return new Error(`The object store answered for ${key} without its ${missing}`);
}

function sizeOf(key: string, bytes: number | undefined): number {
  if (bytes === undefined) {
    throw answeredWithout(key, 'size');
  }
  return bytes;
}

function copySourceOf(bucket: string, key: string): string {
  return [bucket, ...key.split('/')].map((segment) => encodeURIComponent(segment)).join('/');
}

function piecesWithin(source: ReadableStream<unknown>, waitMs: number, key: string): ReadableStream<unknown> {
  const reader = source.getReader();
  return new ReadableStream<unknown>(
    {
      pull: async (controller) => {
        const waited = Promise.withResolvers<'stalled'>();
        const timer = setTimeout(() => {
          waited.resolve('stalled');
        }, waitMs);
        const next = await Promise.race([reader.read(), waited.promise]).finally(() => {
          clearTimeout(timer);
        });
        if (next === 'stalled') {
          controller.error(new Error(`The object store sent no piece of ${key} for ${String(waitMs)} ms`));
          await reader.cancel();
        } else if (next.done) {
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    },
    { highWaterMark: 0 },
  );
}

function isOpenUpload(upload: ListedUpload): upload is OpenUpload {
  return [upload.key, upload.uploadId].every((part) => part !== undefined);
}

export async function bucketReached({ client, name }: Bucket): Promise<void> {
  await client().send(new HeadBucketCommand({ Bucket: name }));
}

export async function heldAt({ client, name }: Bucket, key: string): Promise<Held | undefined> {
  const head = await unlessNotFound(client().send(new HeadObjectCommand({ Bucket: name, Key: key })));
  return head === undefined
    ? undefined
    : { bytes: sizeOf(key, head.ContentLength), mediaType: head.ContentType ?? octets };
}

export async function readAt(
  { client, name }: Bucket,
  key: string,
  { sha256, waitMs }: { readonly sha256: string; readonly waitMs: number },
): Promise<StreamedContent | undefined> {
  const object = await unlessNotFound(client().send(new GetObjectCommand({ Bucket: name, Key: key })));
  if (object === undefined) {
    return undefined;
  }
  if (object.Body === undefined) {
    throw answeredWithout(key, 'body');
  }
  const bytes = sizeOf(key, object.ContentLength);
  return {
    stream: verifiedStream(sha256, bytes, piecesWithin(object.Body.transformToWebStream(), waitMs, key)),
    bytes,
    mediaType: object.ContentType ?? octets,
  };
}

export async function marked({ client, name }: Bucket, key: string): Promise<void> {
  await client().send(new PutObjectCommand({ Bucket: name, Key: key, Body: new Uint8Array() }));
}

export function writtenFirst(
  { client, name }: Bucket,
  key: string,
  { body, mediaType }: { readonly body: Readonly<Uint8Array>; readonly mediaType: string },
): Promise<boolean> {
  const put = new PutObjectCommand({
    Bucket: name,
    Key: key,
    Body: body,
    ContentType: mediaType,
    IfNoneMatch: ifNoneMatch,
  });
  return writtenIfFirst(() => client().send(put));
}

export function copiedFirst({ client, name }: Bucket, from: string, to: string): Promise<boolean> {
  const copy = new CopyObjectCommand({
    Bucket: name,
    Key: to,
    CopySource: copySourceOf(name, from),
    IfNoneMatch: ifNoneMatch,
  });
  return writtenIfFirst(() => client().send(copy));
}

export async function removed(bucket: Bucket, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  const { Errors = [] } = await bucket.client().send(
    new DeleteObjectsCommand({
      Bucket: bucket.name,
      Delete: { Objects: keys.slice(0, mostKeysInOneDelete).map((key) => ({ Key: key })), Quiet: true },
    }),
  );
  if (Errors.length > 0) {
    throw new Error(`The object store kept objects it was asked to delete: ${JSON.stringify(Errors)}`);
  }
  await removed(bucket, keys.slice(mostKeysInOneDelete));
}

export async function* keysUnder(bucket: Bucket, prefix: string, token?: string): AsyncGenerator<string> {
  const page = await bucket
    .client()
    .send(new ListObjectsV2Command({ Bucket: bucket.name, Prefix: prefix, ContinuationToken: token }));
  yield* (page.Contents ?? []).map(({ Key }: Listed) => Key).filter((key) => key !== undefined);
  if (page.IsTruncated === true) {
    yield* keysUnder(bucket, prefix, page.NextContinuationToken);
  }
}

export async function* uploadsUnder(
  bucket: Bucket,
  prefix: string,
  markers?: UploadMarkers,
): AsyncGenerator<OpenUpload> {
  const page = await bucket.client().send(new ListMultipartUploadsCommand({ Bucket: bucket.name, ...markers }));
  yield* (page.Uploads ?? [])
    .map(({ Key, UploadId }: Listed) => ({ key: Key, uploadId: UploadId }))
    .filter((upload: ListedUpload) => isOpenUpload(upload))
    .filter(({ key }) => key.startsWith(prefix));
  if (page.IsTruncated === true) {
    yield* uploadsUnder(bucket, prefix, { KeyMarker: page.NextKeyMarker, UploadIdMarker: page.NextUploadIdMarker });
  }
}

export async function uploadAbandoned({ client, name }: Bucket, { key, uploadId }: OpenUpload): Promise<void> {
  await client().send(new AbortMultipartUploadCommand({ Bucket: name, Key: key, UploadId: uploadId }));
}
