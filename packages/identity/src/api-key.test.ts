import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createApiKey, type KeyGrant } from './index.ts';

const grant: KeyGrant = { id: 'ci-1', org: 'acme', permissions: ['brain:read'], brains: ['alpha'] };

describe('createApiKey', () => {
  it('creates a key of the form abk_<id>_<secret>, the secret being 32 random bytes as base64url', () => {
    const { key } = createApiKey(grant);

    expect(key).toMatch(/^abk_ci-1_[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(key.slice('abk_ci-1_'.length), 'base64url')).toHaveLength(32);
  });

  it('stores the SHA-256 of the whole key as 64 hex characters, with the grant, and never the key', () => {
    const { key, entry } = createApiKey(grant);

    expect(entry).toEqual({
      id: 'ci-1',
      sha256: createHash('sha256').update(key).digest('hex'),
      org: 'acme',
      permissions: ['brain:read'],
      brains: ['alpha'],
    });
    expect(JSON.stringify(entry)).not.toContain(key.slice('abk_ci-1_'.length));
  });

  it('creates a different key each time', () => {
    expect(createApiKey(grant).key).not.toBe(createApiKey(grant).key);
  });
});
