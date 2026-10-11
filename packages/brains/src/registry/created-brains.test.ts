import { describe, expect, it } from 'vitest';

import { brainCreatedOf } from './created-brains.ts';

const context = { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' };

describe('the brain a record of an org creates', () => {
  it('is named by its creation, and by no other record or one without who created it and when', () => {
    expect([
      brainCreatedOf({ type: 'brain_created', data: { brain: 'alpha', name: 'Alpha', description: '' }, context }),
      brainCreatedOf({ type: 'brain_retired', data: { brain: 'alpha' }, context }),
      brainCreatedOf({ type: 'brain_created', data: 'not a fact', context }),
      brainCreatedOf({ type: 'brain_created', data: { brain: 'alpha', name: 'Alpha', description: '' } }),
    ]).toEqual(['alpha', undefined, undefined, undefined]);
  });
});
