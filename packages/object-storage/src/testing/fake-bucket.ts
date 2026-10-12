import { Readable } from 'node:stream';

import { S3ServiceException, type S3Client, type ServiceOutputTypes } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/core/serde';
import { Schema } from 'effect';

import { storageClientOf } from '../client/storage-client.ts';
import { objectContentOn, type ObjectContentStore } from '../content/object-content.ts';
import type { ContentLocation } from '../location/content-location.ts';

interface FakeObject {
  readonly body: Readonly<Uint8Array>;
  readonly mediaType: string | undefined;
}

interface OpenUpload {
  readonly key: string;
  readonly mediaType: string | undefined;
  readonly parts: readonly (readonly [number, Readonly<Uint8Array>])[];
}

type Interceptor = (asked: () => Promise<ServiceOutputTypes>) => Promise<ServiceOutputTypes>;

export interface FakeBucket {
  readonly client: () => S3Client;
  readonly keys: () => readonly string[];
  readonly asked: () => readonly string[];
  readonly openUploads: () => readonly string[];
  readonly intercepting: (command: string, interceptor: Interceptor) => void;
}

export interface FakeBucketOptions {
  readonly pageSize?: number;
  readonly honoursConditionalCopy?: boolean;
}

export interface FakeContentStore extends ObjectContentStore {
  readonly bucket: FakeBucket;
  readonly client: () => S3Client;
}

interface Shelves {
  readonly objectAt: (key: string, name: string) => FakeObject;
  readonly keptFirst: (key: string, object: FakeObject, honoured: boolean, ifNoneMatch?: string) => void;
  readonly dropped: (key: string) => void;
  readonly keys: () => readonly string[];
  readonly uploadAt: (uploadId: string) => OpenUpload;
  readonly opened: (uploadId: string, upload: OpenUpload) => void;
  readonly closed: (uploadId: string) => void;
  readonly uploadIds: () => readonly string[];
  readonly openKeys: () => readonly string[];
  readonly pageSize: number;
}

type Answer = (input: unknown) => ServiceOutputTypes;

const answered = { httpStatusCode: 200 };

const streamedPieceBytes = 65_536;

const keyed = Schema.decodeUnknownSync(Schema.Struct({ Key: Schema.String }));

const put = Schema.decodeUnknownSync(
  Schema.Struct({
    Key: Schema.String,
    Body: Schema.optional(Schema.Uint8Array),
    ContentType: Schema.optional(Schema.String),
    IfNoneMatch: Schema.optional(Schema.String),
  }),
);

const copy = Schema.decodeUnknownSync(
  Schema.Struct({ Key: Schema.String, CopySource: Schema.String, IfNoneMatch: Schema.optional(Schema.String) }),
);

const deleted = Schema.decodeUnknownSync(
  Schema.Struct({ Delete: Schema.Struct({ Objects: Schema.Array(Schema.Struct({ Key: Schema.String })) }) }),
);

const listed = Schema.decodeUnknownSync(
  Schema.Struct({ Prefix: Schema.String, ContinuationToken: Schema.optional(Schema.String) }),
);

const created = Schema.decodeUnknownSync(
  Schema.Struct({ Key: Schema.String, ContentType: Schema.optional(Schema.String) }),
);

const part = Schema.decodeUnknownSync(
  Schema.Struct({ UploadId: Schema.String, PartNumber: Schema.Number, Body: Schema.Uint8Array }),
);

const ofUpload = Schema.decodeUnknownSync(Schema.Struct({ UploadId: Schema.String }));

const listedUploads = Schema.decodeUnknownSync(
  Schema.Struct({ Prefix: Schema.String, UploadIdMarker: Schema.optional(Schema.String) }),
);

const handled = Schema.decodeUnknownSync(Schema.Struct({ commandName: Schema.String }));

const handledWith = Schema.decodeUnknownSync(Schema.Struct({ input: Schema.Unknown }));

const answeredAsAsked: Interceptor = (asked) => asked();

function* piecesOf(body: Readonly<Uint8Array>): Generator<Buffer> {
  for (let start = 0; start < body.byteLength; start += streamedPieceBytes) {
    yield Buffer.from(body.subarray(start, start + streamedPieceBytes));
  }
}

function failure(name: string, httpStatusCode = 404): S3ServiceException {
  return new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode }, message: name });
}

function found<A>(value: A | undefined, name: string): A {
  if (value === undefined) {
    throw failure(name);
  }
  return value;
}

function joined(parts: readonly Readonly<Uint8Array>[]): Uint8Array {
  const whole = new Uint8Array(parts.reduce((total, piece) => total + piece.byteLength, 0));
  parts.reduce((offset, piece) => {
    whole.set(piece, offset);
    return offset + piece.byteLength;
  }, 0);
  return whole;
}

function pageOf(sorted: readonly string[], after: string, size: number) {
  const rest = sorted.filter((item) => item > after);
  const page = rest.slice(0, size);
  return { page: page.length === 0 ? undefined : page, truncated: rest.length > size, last: page.at(-1) };
}

function byKey(left: string, right: string): number {
  return left.localeCompare(right);
}

function objectAnswers(shelves: Shelves, honoursConditionalCopy: boolean): Readonly<Record<string, Answer>> {
  return {
    HeadObjectCommand: (input) => {
      const { body, mediaType } = shelves.objectAt(keyed(input).Key, 'NotFound');
      return { $metadata: answered, ContentLength: body.byteLength, ContentType: mediaType };
    },
    GetObjectCommand: (input) => {
      const { body, mediaType } = shelves.objectAt(keyed(input).Key, 'NoSuchKey');
      const stream = sdkStreamMixin(Readable.from(piecesOf(body)));
      return { $metadata: answered, Body: stream, ContentLength: body.byteLength, ContentType: mediaType };
    },
    PutObjectCommand: (input) => {
      const { Key, Body = new Uint8Array(), ContentType, IfNoneMatch } = put(input);
      shelves.keptFirst(Key, { body: Body, mediaType: ContentType }, true, IfNoneMatch);
      return { $metadata: answered };
    },
    CopyObjectCommand: (input) => {
      const { Key, CopySource, IfNoneMatch } = copy(input);
      const source = CopySource.split('/')
        .slice(1)
        .map((segment) => decodeURIComponent(segment))
        .join('/');
      shelves.keptFirst(Key, shelves.objectAt(source, 'NoSuchKey'), honoursConditionalCopy, IfNoneMatch);
      return { $metadata: answered };
    },
    DeleteObjectsCommand: (input) => {
      for (const { Key } of deleted(input).Delete.Objects) {
        shelves.dropped(Key);
      }
      return { $metadata: answered };
    },
    ListObjectsV2Command: (input) => {
      const { Prefix, ContinuationToken = '' } = listed(input);
      const keys = shelves.keys().filter((key) => key.startsWith(Prefix));
      const { page, truncated, last } = pageOf(keys, ContinuationToken, shelves.pageSize);
      const Contents = page?.map((key) => ({ Key: key }));
      return { $metadata: answered, Contents, IsTruncated: truncated, NextContinuationToken: last };
    },
  };
}

function uploadAnswers(shelves: Shelves): Readonly<Record<string, Answer>> {
  let made = 0;
  return {
    CreateMultipartUploadCommand: (input) => {
      const { Key, ContentType } = created(input);
      made += 1;
      const uploadId = `upload-${String(made).padStart(6, '0')}`;
      shelves.opened(uploadId, { key: Key, mediaType: ContentType, parts: [] });
      return { $metadata: answered, UploadId: uploadId };
    },
    UploadPartCommand: (input) => {
      const { UploadId, PartNumber, Body } = part(input);
      const upload = shelves.uploadAt(UploadId);
      shelves.opened(UploadId, { ...upload, parts: [...upload.parts, [PartNumber, Body]] });
      return { $metadata: answered, ETag: `"part-${String(PartNumber)}"` };
    },
    CompleteMultipartUploadCommand: (input) => {
      const { UploadId } = ofUpload(input);
      const { key, mediaType, parts } = shelves.uploadAt(UploadId);
      const ordered = parts.toSorted(([left], [right]) => left - right).map(([, piece]) => piece);
      shelves.keptFirst(key, { body: joined(ordered), mediaType }, false);
      shelves.closed(UploadId);
      return { $metadata: answered };
    },
    AbortMultipartUploadCommand: (input) => {
      shelves.closed(ofUpload(input).UploadId);
      return { $metadata: answered };
    },
    ListMultipartUploadsCommand: (input) => {
      const { Prefix, UploadIdMarker = '' } = listedUploads(input);
      const open = shelves.uploadIds().filter((uploadId) => shelves.uploadAt(uploadId).key.startsWith(Prefix));
      const { page, truncated, last } = pageOf(open, UploadIdMarker, shelves.pageSize);
      const Uploads = page?.map((uploadId) => ({ Key: shelves.uploadAt(uploadId).key, UploadId: uploadId }));
      return { $metadata: answered, Uploads, IsTruncated: truncated, NextUploadIdMarker: last };
    },
  };
}

function shelvesOf(pageSize: number): Shelves {
  const objects = new Map<string, FakeObject>();
  const uploads = new Map<string, OpenUpload>();
  return {
    objectAt: (key, name) => found(objects.get(key), name),
    keptFirst: (key, object, honoured, ifNoneMatch) => {
      if (honoured && ifNoneMatch === '*' && objects.has(key)) {
        throw failure('PreconditionFailed', 412);
      }
      objects.set(key, object);
    },
    dropped: (key) => {
      objects.delete(key);
    },
    keys: () => [...objects.keys()].toSorted(byKey),
    uploadAt: (uploadId) => found(uploads.get(uploadId), 'NoSuchUpload'),
    opened: (uploadId, upload) => {
      uploads.set(uploadId, upload);
    },
    closed: (uploadId) => {
      uploads.delete(uploadId);
    },
    uploadIds: () => [...uploads.keys()].toSorted(byKey),
    openKeys: () => [...uploads.values()].map(({ key }) => key),
    pageSize,
  };
}

function clientAnswering(answerOf: (command: string, input: unknown) => Promise<ServiceOutputTypes>): S3Client {
  const client = storageClientOf(
    { endpoint: 'http://fake-bucket.invalid', region: 'us-east-1', proxy: { enabled: false, environment: {} } },
    { accessKeyId: 'fake', secretAccessKey: 'fake' },
  );
  client.middlewareStack.add(
    (_next: unknown, context: unknown) => async (args: unknown) => ({
      output: await answerOf(handled(context).commandName, handledWith(args).input),
      response: {},
    }),
    { step: 'initialize', name: 'fakeBucket', priority: 'low' },
  );
  return client;
}

export function fakeBucket({ pageSize = 1000, honoursConditionalCopy = true }: FakeBucketOptions = {}): FakeBucket {
  const shelves = shelvesOf(pageSize);
  const answers = new Map(
    Object.entries({ ...objectAnswers(shelves, honoursConditionalCopy), ...uploadAnswers(shelves) }),
  );
  const asked: string[] = [];
  const interceptors = new Map<string, readonly Interceptor[]>();
  const answerOf = (command: string, input: unknown): Promise<ServiceOutputTypes> => {
    asked.push(command.replace(/Command$/u, ''));
    const [interceptor = answeredAsAsked, ...later] = interceptors.get(command) ?? [];
    interceptors.set(command, later);
    return interceptor(() => Promise.resolve().then(() => found(answers.get(command), 'NotImplemented')(input)));
  };
  return {
    client: () => clientAnswering(answerOf),
    keys: shelves.keys,
    asked: () => [...asked],
    openUploads: shelves.openKeys,
    intercepting: (command, interceptor) => {
      interceptors.set(command, [...(interceptors.get(command) ?? []), interceptor]);
    },
  };
}

export function fakeContentStore(location: ContentLocation, options: FakeBucketOptions = {}): FakeContentStore {
  const bucket = fakeBucket(options);
  const client = bucket.client();
  return { bucket, client: () => client, ...objectContentOn(() => client, location) };
}
