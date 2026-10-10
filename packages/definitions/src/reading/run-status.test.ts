import { describe, expect, it } from 'vitest';

import { runDecider } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { evolveRun, startedRunOf } from '../runs/run-state.ts';
import { recordedWith, testRunId } from '../testing/run-facts.ts';
import { storedTypesByStatus } from './run-status.ts';

const recorded = recordedWith({
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:00.000Z',
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 1,
});

const start: RunEvent = { type: 'run_started', data: { input: {} } };

const ofTheTool = { server: 'chat', tool: 'post_message' };

const latestOfEveryType: Readonly<Record<RunEvent['type'], RunEvent>> = {
  run_started: start,
  run_deferred: { type: 'run_deferred', data: { record: {} } },
  run_succeeded: { type: 'run_succeeded', data: { output: null, record: {} } },
  run_rejected: { type: 'run_rejected', data: { rejection: { reason: 'conflict', detail: 'x' } } },
  run_failed: { type: 'run_failed', data: {} },
  run_cancel_requested: { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed' } },
  tool_call_started: {
    type: 'tool_call_started',
    data: {
      number: 1,
      call_id: 'toolu_01',
      ...ofTheTool,
      arguments_bytes: 2,
      arguments_sha256: 'a'.repeat(64),
      content_kept: true,
    },
  },
  tool_call_answered: {
    type: 'tool_call_answered',
    data: {
      number: 1,
      is_error: false,
      result_bytes: 2,
      result_sha256: 'b'.repeat(64),
      content_kept: true,
      duration_ms: 5,
      jsonrpc_id: 1,
    },
  },
  tool_call_failed: {
    type: 'tool_call_failed',
    data: { number: 1, because: 'timed_out', duration_ms: 5, jsonrpc_id: 1 },
  },
  delivery_started: { type: 'delivery_started', data: { number: 1, target: 'ada', ...ofTheTool } },
  delivery_succeeded: {
    type: 'delivery_succeeded',
    data: {
      number: 1,
      result_bytes: 2,
      result_sha256: 'b'.repeat(64),
      content_kept: true,
      duration_ms: 5,
      jsonrpc_id: 1,
    },
  },
  delivery_failed: { type: 'delivery_failed', data: { number: 1, because: 'lost', duration_ms: 5 } },
  delivery_refused: { type: 'delivery_refused', data: { number: 1, because: 'too_large', duration_ms: 0 } },
  reply_taken: {
    type: 'reply_taken',
    data: { server: 'chat', tool: 'thread_replies', reply: { id: '1699.2', sender: 'ada' }, answer: {} },
  },
  reply_refused: {
    type: 'reply_refused',
    data: {
      server: 'chat',
      tool: 'thread_replies',
      reply: { id: '1699.3', sender: 'ada' },
      because: 'not_an_answer',
      told: true,
    },
  },
};

const statusByStoredType = Object.entries(storedTypesByStatus).flatMap(
  ([status, types]: readonly [string, readonly string[]]) => types.map((type) => [type, status] as const),
);

const latestByType = new Map<string, RunEvent>(Object.values(latestOfEveryType).map((event) => [event.type, event]));

function statusAfter(type: string): string | undefined {
  const latest = latestByType.get(type);
  const started = evolveRun(runDecider.initialState, recorded(start));
  return latest === undefined ? undefined : startedRunOf(evolveRun(started, recorded(latest)))?.run.status;
}

describe('the stored types of a status', () => {
  it('name every fact of a run once', () => {
    expect(statusByStoredType.map(([type]) => type).toSorted()).toEqual(Object.keys(latestOfEveryType).toSorted());
  });

  it.each(statusByStoredType)('give a run whose latest fact is %s the status %s', (type, status) => {
    expect(statusAfter(type)).toBe(status);
  });
});
