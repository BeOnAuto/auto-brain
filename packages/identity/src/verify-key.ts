import { timingSafeEqual } from 'node:crypto';

import { digestOf, keyIdOf, type ApiKey } from './api-key.ts';

const digestOfNoKey = digestOf('abk_');

function sameDigest(presented: string, stored: string): boolean {
  return timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(stored, 'hex'));
}

export function verifyKey(keys: readonly ApiKey[], presented: string): ApiKey | undefined {
  const id = keyIdOf(presented);
  const candidate = keys.find((key) => key.id === id);
  return sameDigest(digestOf(presented), candidate?.sha256 ?? digestOfNoKey) ? candidate : undefined;
}
