import { timingSafeEqual } from 'node:crypto';

import { sha256Of } from '@on.auto/operations';

import { keyIdOf, keyPrefix, type ApiKey } from './api-key.ts';

const digestOfNoKey = sha256Of(keyPrefix);

function sameDigest(presented: string, stored: string): boolean {
  return timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(stored, 'hex'));
}

export function verifyKey(keys: readonly ApiKey[], presented: string): ApiKey | undefined {
  const id = keyIdOf(presented);
  const candidate = keys.find((key) => key.id === id);
  return sameDigest(sha256Of(presented), candidate?.sha256 ?? digestOfNoKey) ? candidate : undefined;
}
