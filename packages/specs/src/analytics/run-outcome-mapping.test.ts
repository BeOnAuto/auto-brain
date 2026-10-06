import type { RunOutcome } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { runOutcomeMapping } from './run-outcome-mapping.ts';

const fact = { by: 'acme-admin' };

function startedAt(at: string, name = 'triage', primitive = 'inference') {
  return { type: 'execution_started', primitive, name, spec_version: 1, input: {}, ...fact, at };
}

const usage = {
  input: { total: 1200, uncached: 200, cache_read: 1000, cache_write: 0 },
  output: { total: 300, text: 250, reasoning: 50 },
  total: 1500,
};

function keptAfter(...events: readonly unknown[]): RunOutcome | undefined {
  let row: RunOutcome | undefined;
  for (const event of events) {
    row = runOutcomeMapping.rowAfter(row, event) ?? row;
  }
  return row;
}

const started = startedAt('2026-10-01T09:00:00.000Z');

const firstStart = {
  startedDay: '2026-10-01',
  startedAt: '2026-10-01T09:00:00.000Z',
  lastStartedAt: '2026-10-01T09:00:00.000Z',
  primitive: 'inference',
  name: 'triage',
};

const noTokens = { inputTokens: null, outputTokens: null, cachedTokens: null };

describe('the outcome of a run', () => {
  it('reads the types of the run events that change it', () => {
    expect(runOutcomeMapping.types).toEqual([
      'execution_started',
      'execution_succeeded',
      'execution_failed',
      'execution_rejected',
    ]);
  });

  it('is started from its first start', () => {
    expect(keptAfter(started)).toEqual({ ...firstStart, status: 'started', durationMs: null, ...noTokens });
  });
});

describe('the outcome of a run that ended', () => {
  it('takes the tokens a reasoning run recorded and its duration from start to end when it succeeds', () => {
    const succeeded = { type: 'execution_succeeded', output: 'ok', record: { usage, duration_ms: 900 }, ...fact };

    expect(keptAfter(started, { ...succeeded, at: '2026-10-01T09:00:01.250Z' })).toEqual({
      ...firstStart,
      status: 'succeeded',
      durationMs: 1250,
      inputTokens: 1200,
      outputTokens: 300,
      cachedTokens: 1000,
    });
  });

  it('takes the duration of a workflow run, whose record holds no tokens', () => {
    const workflow = startedAt('2026-10-01T09:00:00.000Z', 'approval', 'orchestration');
    const deferred = { type: 'execution_deferred', record: { run: 'r1' }, ...fact, at: '2026-10-01T09:00:00.100Z' };
    const succeeded = { type: 'execution_succeeded', output: {}, record: {}, ...fact, at: '2026-10-02T09:00:00.000Z' };

    expect(keptAfter(workflow, deferred, succeeded)).toEqual({
      ...firstStart,
      primitive: 'orchestration',
      name: 'approval',
      status: 'succeeded',
      durationMs: 86_400_000,
      ...noTokens,
    });
  });

  it('takes the duration of a failed run, with no tokens', () => {
    expect(keptAfter(started, { type: 'execution_failed', ...fact, at: '2026-10-01T09:00:02.000Z' })).toEqual({
      ...firstStart,
      status: 'failed',
      durationMs: 2000,
      ...noTokens,
    });
  });
});

describe('the outcome of a rejected run', () => {
  it('counts the tokens of a rejected run that recorded them, never a duration', () => {
    const rejection = { reason: 'unavailable', detail: 'The answer is not JSON' };
    const rejected = { type: 'execution_rejected', rejection, ...fact, at: '2026-10-01T09:00:03.000Z' };

    expect([keptAfter(started, { ...rejected, record: { usage } }), keptAfter(started, rejected)]).toEqual([
      { ...firstStart, status: 'rejected', durationMs: null, inputTokens: 1200, outputTokens: 300, cachedTokens: 1000 },
      { ...firstStart, status: 'rejected', durationMs: null, ...noTokens },
    ]);
  });
});

describe('the outcome of a run started again or measured oddly', () => {
  it('keeps its first start when started again, and measures the attempt started last', () => {
    const failed = { type: 'execution_failed', ...fact, at: '2026-10-01T09:01:00.000Z' };
    const again = startedAt('2026-10-02T10:00:00.000Z', 'renamed');
    const succeeded = {
      type: 'execution_succeeded',
      output: 'ok',
      record: {},
      ...fact,
      at: '2026-10-02T10:00:05.000Z',
    };

    expect([keptAfter(started, failed, again), keptAfter(started, failed, again, succeeded)]).toEqual([
      { ...firstStart, lastStartedAt: '2026-10-02T10:00:00.000Z', status: 'started', durationMs: null, ...noTokens },
      { ...firstStart, lastStartedAt: '2026-10-02T10:00:00.000Z', status: 'succeeded', durationMs: 5000, ...noTokens },
    ]);
  });
});

describe('the outcome of a run with a finish it cannot measure', () => {
  it('is kept with the day of its finish when the finish comes without a start', () => {
    expect(keptAfter({ type: 'execution_failed', ...fact, at: '2026-10-03T23:59:59.999Z' })).toEqual({
      startedDay: '2026-10-03',
      startedAt: '2026-10-03T23:59:59.999Z',
      lastStartedAt: '2026-10-03T23:59:59.999Z',
      primitive: '',
      name: '',
      status: 'failed',
      durationMs: null,
      ...noTokens,
    });
  });

  it('takes no duration from a row whose start it cannot read', () => {
    const row: RunOutcome = {
      ...firstStart,
      lastStartedAt: 'not a time',
      status: 'started',
      durationMs: null,
      ...noTokens,
    };

    expect(
      runOutcomeMapping.rowAfter(row, { type: 'execution_failed', ...fact, at: '2026-10-01T09:00:01.000Z' }),
    ).toMatchObject({ status: 'failed', durationMs: null });
  });

  it('takes no duration below zero, when a finish is recorded before its start by another clock', () => {
    expect(keptAfter(started, { type: 'execution_failed', ...fact, at: '2026-10-01T08:59:59.000Z' })).toMatchObject({
      durationMs: 0,
    });
  });
});

const notTokens: readonly unknown[] = [
  'a record that is text',
  ['a', 'list'],
  { usage: 'none' },
  { usage: { input: { total: '12', cache_read: -1 }, output: { total: 2.5 } } },
  { usage: { input: { total: Number.MAX_SAFE_INTEGER + 2 }, output: null } },
  { usage: { input: [12] } },
];

const notRunEvents: readonly unknown[] = [
  null,
  'execution_started',
  7,
  [],
  { type: 'execution_started', primitive: 'inference', at: '2026-10-01T09:00:00.000Z' },
  { type: 'execution_started', primitive: 'inference', name: 'triage', at: 'not a time' },
  { type: 'execution_succeeded' },
  { type: 'execution_deferred', at: '2026-10-01T09:00:00.000Z' },
  { type: 'tool_call_started', at: '2026-10-01T09:00:00.000Z' },
];

describe('what the outcome of a run leaves as it is', () => {
  it.each(notTokens)('is the tokens of a record that holds no counts, %j', (record) => {
    const succeeded = { type: 'execution_succeeded', output: 'ok', record, ...fact, at: '2026-10-01T09:00:01.000Z' };

    expect(keptAfter(started, succeeded)).toMatchObject(noTokens);
  });

  it.each(notRunEvents)('is the row, for an event it does not understand, %j', (event) => {
    const row = keptAfter(started);

    expect([runOutcomeMapping.rowAfter(row, event), runOutcomeMapping.rowAfter(undefined, event)]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
