import { describe, expect, it } from 'vitest';

import { brainCreatedOf } from './created-brains.ts';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

describe('the brain a record of an org creates', () => {
  it('is named by its creation, and by no other record', () => {
    expect([
      brainCreatedOf({ type: 'brain_created', brain: 'alpha', name: 'Alpha', description: '', ...fact }),
      brainCreatedOf({ type: 'brain_retired', brain: 'alpha', ...fact }),
      brainCreatedOf('not a record'),
    ]).toEqual(['alpha', undefined, undefined]);
  });
});
