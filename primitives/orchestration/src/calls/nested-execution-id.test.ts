import { describe, expect, it } from 'vitest';

import { nestedExecutionId } from './nested-execution-id.ts';

const nameBasedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('the id of an execution a workflow runs', () => {
  it('is a name-based UUID, the same for the same run, task and run of the task', () => {
    const id = nestedExecutionId('run-1', '/do/0/ask', 1);

    expect(id).toMatch(nameBasedUuid);
    expect(nestedExecutionId('run-1', '/do/0/ask', 1)).toBe(id);
  });

  it('is the id the runs already started were given, so a call started again is the same execution', () => {
    expect([
      nestedExecutionId('run-1', '/do/0/ask', 1),
      nestedExecutionId('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '/do/0/judge', 2),
      nestedExecutionId('run-1', '/do/0/naïve', 1),
    ]).toEqual([
      'ae7e2bc1-745e-50af-805b-41d801887d11',
      'fa69afbd-33e5-52d8-9b80-0074bb97e33c',
      'b631d0fa-bf40-5e88-9f35-d21b8c0836e2',
    ]);
  });

  it('differs for another run, another task or another run of the task', () => {
    const ids = new Set([
      nestedExecutionId('run-1', '/do/0/ask', 1),
      nestedExecutionId('run-2', '/do/0/ask', 1),
      nestedExecutionId('run-1', '/do/1/ask', 1),
      nestedExecutionId('run-1', '/do/0/ask', 2),
    ]);

    expect(ids.size).toBe(4);
  });
});
