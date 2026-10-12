import type { S3Client } from '@aws-sdk/client-s3';
import type { RecordedContent } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ContentLocation } from '../location/content-location.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { readAt } from './bucket-requests.ts';
import { stagedOn, unstagedOn } from './object-staging.ts';
import { placedOn, type Placing } from './object-writes.ts';
import { sweptUploads } from './upload-sweep.ts';

export interface ObjectContentStore {
  readonly content: RecordedContent;
  readonly sweepContent: (before: number) => Promise<void>;
}

export function objectContentOn(client: () => S3Client, location: ContentLocation): ObjectContentStore {
  const placing: Placing = { bucket: { client, name: location.bucket }, keys: objectKeysOf(location) };
  const { bucket, keys } = placing;
  return {
    content: {
      put: (brain, content) => placedOn(placing, (sha256) => keys.kept(brain, sha256), content),
      get: (brain, sha256) => Effect.promise(() => readAt(bucket, keys.kept(brain, sha256), sha256)),
      stage: (brain, run, content) => stagedOn(placing, { brain, run }, content),
      staged: (brain, run, sha256) => Effect.promise(() => readAt(bucket, keys.staged(brain, run, sha256), sha256)),
      unstage: (brain, run) => Effect.promise(() => unstagedOn(placing, { brain, run })),
    },
    sweepContent: (before) => sweptUploads(bucket, keys.uploads, before),
  };
}
