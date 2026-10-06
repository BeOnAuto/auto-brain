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
  tool_call_started: {
    type: 'tool_call_started',
    number: 1,
    call_id: 'toolu_01',
    server: 'graph',
    tool: 'search',
    arguments_bytes: 2,
    arguments_sha256: 'a'.repeat(64),
    ...fact,
  },
  tool_call_answered: {
    type: 'tool_call_answered',
    number: 1,
    outcome: 'result',
    result_bytes: 2,
    result_sha256: 'b'.repeat(64),
    duration_ms: 5,
    jsonrpc_id: 1,
    ...fact,
  },
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
