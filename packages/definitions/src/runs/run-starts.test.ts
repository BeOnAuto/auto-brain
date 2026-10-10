import { describe, expect, it } from 'vitest';

import { runStartedOf } from './run-starts.ts';

const context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'brain:alpha',
  definitionType: 'workflow',
  definitionName: 'close',
};

describe('the start of a run read from its record', () => {
  it('is the context of the start, and nothing for any other record', () => {
    expect([
      runStartedOf({ type: 'run_started', data: { input: {} }, context: { ...context, depth: 2 } }),
      runStartedOf({ type: 'run_failed', data: {}, context }),
      runStartedOf({ type: 'run_started', data: { input: {} } }),
      runStartedOf('not a record'),
    ]).toEqual([{ ...context, depth: 2 }, undefined, undefined, undefined]);
  });
});
