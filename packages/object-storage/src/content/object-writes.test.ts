import { PutObjectCommand, S3ServiceException } from '@aws-sdk/client-s3';
import { sha256Of, textToKeep } from '@beonauto/operations';
import { alpha, generated, octets, resultOf } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { objectKeysOf } from '../location/object-keys.ts';
import { fakeContentStore, type FakeContentStore } from '../testing/fake-bucket.ts';
import { uploadPartBytes } from './upload-writing.ts';

const location = { bucket: 'content', prefix: 'brains' };

const keys = objectKeysOf(location);

function writtenBefore(store: FakeContentStore, command: string, key: string, mediaType?: string): void {
  store.bucket.intercepting(command, async (asked) => {
    const put = new PutObjectCommand({
      Bucket: location.bucket,
      Key: key,
      Body: new Uint8Array(1),
      ContentType: mediaType,
    });
    await store.client().send(put);
    return asked();
  });
}

describe('a put on object storage', () => {
  it('writes a content of one chunk straight under its digest, and nothing when the brain holds it', async () => {
    const store = fakeContentStore(location);

    const kept = await resultOf(store.content.put(alpha, textToKeep('{"a":1}', 'application/json')));
    await resultOf(store.content.put(alpha, textToKeep('{"a":1}', 'text/plain')));

    expect(kept).toEqual({ sha256: sha256Of('{"a":1}'), bytes: 7, mediaType: 'application/json' });
    expect(store.bucket.asked()).toEqual(['HeadObject', 'PutObject', 'HeadObject']);
    expect(store.bucket.keys()).toEqual([keys.kept(alpha, kept.sha256)]);
  });

  it('uploads a larger content under an upload of its own, copies it under its digest and deletes the upload, or deletes the upload alone when the digest is held', async () => {
    const store = fakeContentStore(location);
    const { sha256, content } = await generated(2_500_000);

    await resultOf(store.content.put(alpha, content()));
    await resultOf(store.content.put(alpha, content()));

    expect(store.bucket.asked()).toEqual([
      'PutObject',
      'HeadObject',
      'CopyObject',
      'DeleteObjects',
      'PutObject',
      'HeadObject',
      'DeleteObjects',
    ]);
    expect(store.bucket.keys()).toEqual([keys.kept(alpha, sha256)]);
  });
});

describe('a put on object storage of a content larger than a part', () => {
  it('uploads it in parts, and reads a stream through the digest alone when its expected digest is held', async () => {
    const store = fakeContentStore(location);
    const { sha256, content } = await generated(2 * uploadPartBytes + 10);

    await resultOf(store.content.put(alpha, content()));
    const again = await resultOf(store.content.put(alpha, { ...content(), expected: { sha256 } }));

    expect(store.bucket.asked()).toEqual([
      'CreateMultipartUpload',
      'UploadPart',
      'UploadPart',
      'UploadPart',
      'CompleteMultipartUpload',
      'HeadObject',
      'CopyObject',
      'DeleteObjects',
      'HeadObject',
    ]);
    expect(again).toEqual({ sha256, bytes: 2 * uploadPartBytes + 10, mediaType: octets });
  });
});

describe('a put on object storage that another put of its digest raced', () => {
  it('answers what the put that wrote first kept, between its look and its write', async () => {
    const store = fakeContentStore(location);
    const { sha256, content } = await generated(2_500_000);
    writtenBefore(store, 'PutObjectCommand', keys.kept(alpha, sha256Of('small')), 'text/csv');
    writtenBefore(store, 'CopyObjectCommand', keys.kept(alpha, sha256), 'text/csv');

    const kept = [
      await resultOf(store.content.put(alpha, textToKeep('small', octets))),
      await resultOf(store.content.put(alpha, content())),
    ];

    expect(kept).toEqual([
      { sha256: sha256Of('small'), bytes: 1, mediaType: 'text/csv' },
      { sha256, bytes: 1, mediaType: 'text/csv' },
    ]);
    expect(store.bucket.keys()).toEqual([keys.kept(alpha, sha256Of('small')), keys.kept(alpha, sha256)].toSorted());
  });

  it('answers what it kept where the store copies over the put that wrote first', async () => {
    const store = fakeContentStore(location, { honoursConditionalCopy: false });
    const { sha256, content } = await generated(2_500_000);
    writtenBefore(store, 'CopyObjectCommand', keys.kept(alpha, sha256));

    const kept = await resultOf(store.content.put(alpha, content()));

    expect(kept).toEqual({ sha256, bytes: 2_500_000, mediaType: octets });
  });

  it('fails as a defect when the store says another put wrote first but holds nothing under the digest', async () => {
    const store = fakeContentStore(location);
    store.bucket.intercepting('PutObjectCommand', () =>
      Promise.reject(
        new S3ServiceException({ name: 'PreconditionFailed', $fault: 'client', $metadata: { httpStatusCode: 412 } }),
      ),
    );

    const put = Effect.runPromise(store.content.put(alpha, textToKeep('lost', octets)));

    await expect(put).rejects.toThrow(
      `No object holds the content just put under ${keys.kept(alpha, sha256Of('lost'))}, though nothing deletes what is kept`,
    );
  });
});
