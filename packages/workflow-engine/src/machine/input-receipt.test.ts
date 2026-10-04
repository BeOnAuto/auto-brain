import { describe, expect, it } from 'vitest';

import { callKeyText, isStale, newRun, receiptOf, type RunInput } from '../index.ts';
import { armedTimer, at, executionId, openCall, runningState, started } from '../testing/runs.ts';

const fired = (timerId: string): RunInput => ({ kind: 'timer_fired', executionId, at, timerId });

const answered = (run: number): RunInput => ({
  kind: 'call_answered',
  executionId,
  at,
  key: { ...openCall, run },
  result: { status: 'succeeded', output: { approved: true } },
});

const received = (id: string): RunInput => ({
  kind: 'event_received',
  executionId,
  at,
  event: { id, type: 'com.acme.approval' },
});

const cancelled: RunInput = { kind: 'cancel_requested', executionId, at };

describe('the receipt of an input', () => {
  it('names the input by the key it is deduplicated by', () => {
    expect(
      [started, fired(armedTimer), answered(1), received('event-9'), cancelled].map((input) => receiptOf(input)),
    ).toEqual([
      { kind: 'started', key: executionId, at },
      { kind: 'timer_fired', key: armedTimer, at },
      { kind: 'call_answered', key: callKeyText(openCall), at },
      { kind: 'event_received', key: 'event-9', at },
      { kind: 'cancel_requested', key: executionId, at },
    ]);
  });
});

describe('an input that can still change a run', () => {
  it('is a start of a new run, the fire of an armed timer, the answer of an open call, a new event or the first cancel', () => {
    expect(
      [
        isStale(newRun, started),
        isStale(runningState, fired(armedTimer)),
        isStale(runningState, answered(1)),
        isStale(runningState, received('event-3')),
        isStale(runningState, cancelled),
      ].every((stale) => !stale),
    ).toBe(true);
  });
});

describe('a stale input', () => {
  it('is a second start, a fire of a timer not armed, an answer of a call not open, an event seen before or a second cancel', () => {
    expect([
      isStale(runningState, started),
      isStale(runningState, fired(`${executionId}/timers/9`)),
      isStale(runningState, answered(2)),
      isStale(runningState, received('event-1')),
      isStale({ ...runningState, cancelRequested: true }, cancelled),
    ]).toEqual([true, true, true, true, true]);
  });

  it('is anything but a start for a run that has not started, has ended, or is another run', () => {
    expect([
      isStale(newRun, fired(armedTimer)),
      isStale({ ...runningState, status: 'ended' }, answered(1)),
      isStale({ ...runningState, executionId: 'another' }, received('event-3')),
    ]).toEqual([true, true, true]);
  });
});
