import { describe, expect, it } from 'vitest';

import { brainCreatedOf } from './created-brains.ts';

describe('the brain a record of an org creates', () => {
  it('is named by its creation, and by no other record', () => {
    expect([
      brainCreatedOf({ type: 'brain_created', data: { brain: 'alpha', name: 'Alpha', description: '' } }),
      brainCreatedOf({ type: 'brain_retired', data: { brain: 'alpha' } }),
      brainCreatedOf({ type: 'brain_created', data: 'not a fact' }),
    ]).toEqual(['alpha', undefined, undefined]);
  });
});
