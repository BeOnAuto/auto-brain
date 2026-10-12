import { objectContentOn, objectStoreReached, storageClientOf } from '@beonauto/object-storage';
import type { ContentStore } from '@beonauto/operations';
import { awsCredentialChain } from '@beonauto/outbound/aws';
import { Effect } from 'effect';

import type { Settings } from '../settings/settings.ts';

export interface ComposedContentStore {
  readonly store: ContentStore;
  readonly reached: Effect.Effect<void>;
}

function hostOf(endpoint: string | undefined): string {
  return endpoint === undefined ? 'the S3 endpoint of its region' : new URL(endpoint).host;
}

export function contentStoreOf({
  content,
  proxy,
}: Pick<Settings, 'content' | 'proxy'>): ComposedContentStore | undefined {
  if (content.store === 'ledger') {
    return undefined;
  }
  const { endpoint, region, location } = content;
  const client = storageClientOf({ endpoint, region, proxy }, awsCredentialChain(proxy));
  const unreachable = (answer: string) =>
    new Error(
      `CONTENT_STORE_URL names the bucket ${location.bucket} on ${hostOf(endpoint)}, which could not be reached: ${answer}`,
    );
  return {
    store: objectContentOn(() => client, location),
    reached: objectStoreReached(() => client, location).pipe(
      Effect.catchTag('object_store_unreachable', ({ answer }: { readonly answer: string }) =>
        Effect.die(unreachable(answer)),
      ),
    ),
  };
}
