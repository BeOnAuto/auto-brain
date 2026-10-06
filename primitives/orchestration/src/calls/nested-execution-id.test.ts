import { describe, expect, it } from 'vitest';

import { nestedExecutionId } from './nested-execution-id.ts';

const nameBasedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('the id of an execution a workflow runs', () => {
  it('is a name-based UUID, the same for the same run, task and run of the task', () => {
    const id = nestedExecutionId('run-1', '/do/0/ask', 1);

    expect(id).toMatch(nameBasedUuid);
    expect(nestedExecutionId('run-1', '/do/0/ask', 1)).toBe(id);
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
