import { S3ServiceException, type S3Client } from '@aws-sdk/client-s3';
import type { ContentStore } from '@on.auto/operations';
import { Data, Effect } from 'effect';

import { storageWaits, type StorageWaits } from '../client/storage-client.ts';
import type { ContentLocation } from '../location/content-location.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { bucketReached, readAt } from './bucket-requests.ts';
import { stagedOn, unstagedOn } from './object-staging.ts';
import { placedOn, type Placing } from './object-writes.ts';
import { sweptUploads } from './upload-sweep.ts';

export class ObjectStoreUnreachable extends Data.TaggedError('object_store_unreachable')<{
  readonly bucket: string;
  readonly answer: string;
}> {}

function answerOf(failure: unknown): string {
  if (failure instanceof S3ServiceException) {
    return `${failure.name} (${String(failure.$metadata.httpStatusCode)})`;
  }
  return String(failure);
}

export function objectStoreReached(
  client: () => S3Client,
  { bucket }: ContentLocation,
): Effect.Effect<void, ObjectStoreUnreachable> {
  return Effect.tryPromise({
    try: () => bucketReached({ client, name: bucket }),
    catch: (failure) => new ObjectStoreUnreachable({ bucket, answer: answerOf(failure) }),
  });
}

export function objectContentOn(
  client: () => S3Client,
  location: ContentLocation,
  { requestMs }: StorageWaits = storageWaits,
): ContentStore {
  const placing: Placing = { bucket: { client, name: location.bucket }, keys: objectKeysOf(location) };
  const { bucket, keys } = placing;
  const readOf = (key: string, sha256: string) =>
    Effect.promise(() => readAt(bucket, key, { sha256, waitMs: requestMs }));
  return {
    content: {
      put: (playbook, content) => placedOn(placing, (sha256) => keys.kept(playbook, sha256), content),
      get: (playbook, sha256) => readOf(keys.kept(playbook, sha256), sha256),
      stage: (playbook, run, content) => stagedOn(placing, { playbook, run }, content),
      staged: (playbook, run, sha256) => readOf(keys.staged(playbook, run, sha256), sha256),
      unstage: (playbook, run) => Effect.promise(() => unstagedOn(placing, { playbook, run })),
    },
    sweepContent: (before) => sweptUploads(bucket, keys.uploads, before),
  };
}
