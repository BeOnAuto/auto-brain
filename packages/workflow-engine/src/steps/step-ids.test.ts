import { uuidV5 } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { stepEventIdOf } from './step-ids.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const waiting = { reference: '/do/0/ask', run: 2, outcome: 'waiting', times: 1 } as const;

describe('the id of a step event', () => {
  it('is a version 5 UUID of the run, the reference, the run count, the outcome and the times, in a namespace of its own', () => {
    expect(stepEventIdOf(executionId, waiting)).toBe(
      uuidV5('1e08cd36-b0d0-4ce3-bd92-cd36f7e6c276', JSON.stringify([executionId, '/do/0/ask', 2, 'waiting', 1])),
    );
  });

  it('differs when any of the five differs, and stays the same on every derivation', () => {
    const ids = [
      stepEventIdOf(executionId, waiting),
      stepEventIdOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b', waiting),
      stepEventIdOf(executionId, { ...waiting, reference: '/do/1/ask' }),
      stepEventIdOf(executionId, { ...waiting, run: 3 }),
      stepEventIdOf(executionId, { ...waiting, outcome: 'started' }),
      stepEventIdOf(executionId, { ...waiting, times: 2 }),
    ];

    expect(new Set(ids).size).toBe(6);
    expect(stepEventIdOf(executionId, waiting)).toBe(ids[0]);
  });
});
