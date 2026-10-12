import type { ContentStore } from '@beonauto/ledger';
import { objectContentOn, storageClientOf } from '@beonauto/object-storage';
import { awsCredentialChain } from '@beonauto/outbound/aws';

import type { Settings } from '../settings/settings.ts';

export function contentStoreOf({ content, models }: Pick<Settings, 'content' | 'models'>): ContentStore | undefined {
  if (content.store === 'ledger') {
    return undefined;
  }
  const { endpoint, region, location } = content;
  const client = storageClientOf({ endpoint, region, proxy: models.proxy }, awsCredentialChain(models.proxy));
  return objectContentOn(() => client, location);
}
