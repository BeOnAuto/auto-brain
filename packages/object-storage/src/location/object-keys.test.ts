import { describe, expect, it } from 'vitest';

import { objectKeysOf } from './object-keys.ts';

const alpha = { org: 'acme', brain: 'alpha' };

const sha256 = 'a'.repeat(64);

describe('the keys of the content on object storage', () => {
  it('keep a content under the brain key of its brain and its digest, and stage it under its run', () => {
    const keys = objectKeysOf({ bucket: 'brain-content', prefix: 'production' });

    expect([
      keys.kept(alpha, sha256),
      keys.uploads,
      keys.upload('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'),
      keys.run(alpha, 'run-1'),
      keys.staged(alpha, 'run-1', sha256),
      keys.ended(alpha, 'run-1'),
    ]).toEqual([
      `production/brain/acme/alpha/${sha256}`,
      'production/uploads/',
      'production/uploads/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      'production/staging/brain/acme/alpha/run-1/',
      `production/staging/brain/acme/alpha/run-1/${sha256}`,
      'production/staging/brain/acme/alpha/run-1/.ended',
    ]);
  });

  it('start at the root of the bucket without a prefix, and keep a run in one segment of a key', () => {
    const keys = objectKeysOf({ bucket: 'brain-content', prefix: '' });

    expect([keys.kept(alpha, sha256), keys.staged(alpha, 'run/1', sha256)]).toEqual([
      `brain/acme/alpha/${sha256}`,
      `staging/brain/acme/alpha/run%2F1/${sha256}`,
    ]);
  });
});
