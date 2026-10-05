import { describe, expect, it } from 'vitest';

import { executionDecider } from '../execution/execution-decider.ts';
import type { ExecutionEvent } from '../execution/execution-events.ts';
import { evolveExecution } from '../execution/execution-state.ts';
import { storedTypesByStatus } from './execution-status.ts';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const start: ExecutionEvent = {
  type: 'execution_started',
  primitive: 'echo',
  name: 'greet',
  spec_version: 1,
  input: {},
  ...fact,
};

const latestOfEveryType: Readonly<Record<ExecutionEvent['type'], ExecutionEvent>> = {
  execution_started: start,
  execution_deferred: { type: 'execution_deferred', record: {}, ...fact },
  execution_succeeded: { type: 'execution_succeeded', output: null, record: {}, ...fact },
  execution_rejected: { type: 'execution_rejected', rejection: { reason: 'conflict', detail: 'x' }, ...fact },
  execution_failed: { type: 'execution_failed', ...fact },
};

const statusByStoredType = Object.entries(storedTypesByStatus).flatMap(
  ([status, types]: readonly [string, readonly string[]]) => types.map((type) => [type, status] as const),
);

const latestByType = new Map<string, ExecutionEvent>(
  Object.values(latestOfEveryType).map((event) => [event.type, event]),
);

function statusAfter(type: string): string | undefined {
  const latest = latestByType.get(type);
  const started = evolveExecution(executionDecider.initialState, start);
  return latest === undefined ? undefined : evolveExecution(started, latest)?.execution.status;
}

describe('the stored types of a status', () => {
  it('name every fact of an execution once', () => {
    expect(statusByStoredType.map(([type]) => type).toSorted()).toEqual(Object.keys(latestOfEveryType).toSorted());
  });

  it.each(statusByStoredType)('give a run whose latest fact is %s the status %s', (type, status) => {
    expect(statusAfter(type)).toBe(status);
  });
});
