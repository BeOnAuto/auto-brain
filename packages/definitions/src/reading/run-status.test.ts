import { describe, expect, it } from 'vitest';

import { runDecider } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { evolveRun, startedRunOf } from '../runs/run-state.ts';
import { storedTypesByStatus } from './run-status.ts';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const start: RunEvent = {
  type: 'run_started',
  definition_type: 'echo',
  name: 'greet',
  definition_version: 1,
  input: {},
  ...fact,
};

const ofGreet = { definition_type: 'echo', name: 'greet', definition_version: 1 };

const latestOfEveryType: Readonly<Record<RunEvent['type'], RunEvent>> = {
  run_started: start,
  run_deferred: { type: 'run_deferred', record: {}, ...ofGreet, ...fact },
  run_succeeded: { type: 'run_succeeded', output: null, record: {}, ...ofGreet, ...fact },
  run_rejected: {
    type: 'run_rejected',
    rejection: { reason: 'conflict', detail: 'x' },
    ...ofGreet,
    ...fact,
  },
  run_failed: { type: 'run_failed', ...ofGreet, ...fact },
  run_cancel_requested: {
    type: 'run_cancel_requested',
    kind: 'requested',
    reason: 'Not needed',
    ...ofGreet,
    ...fact,
  },
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
  delivery_started: {
    type: 'delivery_started',
    number: 1,
    target: 'ada',
    server: 'chat',
    tool: 'post_message',
    ...ofGreet,
    ...fact,
  },
  delivery_ended: {
    type: 'delivery_ended',
    number: 1,
    outcome: 'delivered',
    duration_ms: 5,
    ...ofGreet,
    ...fact,
  },
  reply_taken: {
    type: 'reply_taken',
    server: 'chat',
    tool: 'thread_replies',
    reply: { id: '1699.2', sender: 'ada' },
    answer: { choice: 'approve' },
    ...ofGreet,
    ...fact,
  },
  reply_refused: {
    type: 'reply_refused',
    server: 'chat',
    tool: 'thread_replies',
    reply: { id: '1699.3', sender: 'ada' },
    because: 'not_an_answer',
    told: true,
    ...ofGreet,
    ...fact,
  },
};

const statusByStoredType = Object.entries(storedTypesByStatus).flatMap(
  ([status, types]: readonly [string, readonly string[]]) => types.map((type) => [type, status] as const),
);

const latestByType = new Map<string, RunEvent>(Object.values(latestOfEveryType).map((event) => [event.type, event]));

function statusAfter(type: string): string | undefined {
  const latest = latestByType.get(type);
  const started = evolveRun(runDecider.initialState, start);
  return latest === undefined ? undefined : startedRunOf(evolveRun(started, latest))?.run.status;
}

describe('the stored types of a status', () => {
  it('name every fact of a run once', () => {
    expect(statusByStoredType.map(([type]) => type).toSorted()).toEqual(Object.keys(latestOfEveryType).toSorted());
  });

  it.each(statusByStoredType)('give a run whose latest fact is %s the status %s', (type, status) => {
    expect(statusAfter(type)).toBe(status);
  });
});
