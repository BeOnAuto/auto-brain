import { uuidV7Before } from '@beonauto/operations';

import { keysUnder, removed, uploadAbandoned, uploadsUnder, type Bucket } from './bucket-requests.ts';

function startedBefore(key: string, before: number): boolean {
  return uuidV7Before(key.slice(key.lastIndexOf('/') + 1), before);
}

async function staleObjectsUnder(bucket: Bucket, uploads: string, before: number): Promise<readonly string[]> {
  const stale: string[] = [];
  for await (const key of keysUnder(bucket, uploads)) {
    if (!startedBefore(key, before)) {
      break;
    }
    stale.push(key);
  }
  return stale;
}

export async function sweptUploads(bucket: Bucket, uploads: string, before: number): Promise<void> {
  await removed(bucket, await staleObjectsUnder(bucket, uploads, before));
  for await (const open of uploadsUnder(bucket, uploads)) {
    if (startedBefore(open.key, before)) {
      await uploadAbandoned(bucket, open);
    }
  }
}
