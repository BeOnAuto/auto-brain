import { describe, expect, it } from 'vitest';

import { callKeyText, clampedAt, inputTimeOf, receiptOf, type RunInput } from '../index.ts';
import { armedTimer, at, executionId, openCall, runningState, started } from '../testing/runs.ts';

const inputs: readonly RunInput[] = [
  started,
  { kind: 'timer_fired', executionId, at, timerId: armedTimer },
  { kind: 'call_answered', executionId, at, key: openCall, result: { status: 'failed', detail: 'boom' } },
  {
    kind: 'call_answered',
    executionId,
    at,
    key: openCall,
    result: {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'no',
      kind: 'tool_not_offered',
      because: 'tool_not_allowed',
    },
  },
  {
    kind: 'call_answered',
    executionId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'conflict', detail: 'no', kind: 'tools_called' },
  },
  {
    kind: 'call_answered',
    executionId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'conflict', detail: 'no' },
  },
  { kind: 'event_received', executionId, at, event: { id: 'event-9', type: 'com.acme.approval' } },
  { kind: 'cancel_requested', executionId, at },
];

describe('the receipt of an input', () => {
  it('names the input by the key it is deduplicated by, with the status of an answer, the kind and because of a rejection, or the type of an event', () => {
    expect(inputs.map((input) => receiptOf(input, at))).toEqual([
      { kind: 'started', key: executionId, at },
      { kind: 'timer_fired', key: armedTimer, at },
      { kind: 'call_answered', key: callKeyText(openCall), at, status: 'failed' },
      {
        kind: 'call_answered',
        key: callKeyText(openCall),
        at,
        status: 'rejected',
        rejection: { kind: 'tool_not_offered', because: 'tool_not_allowed' },
      },
      {
        kind: 'call_answered',
        key: callKeyText(openCall),
        at,
        status: 'rejected',
        rejection: { kind: 'tools_called' },
      },
      { kind: 'call_answered', key: callKeyText(openCall), at, status: 'rejected' },
      { kind: 'event_received', key: 'event-9', at, eventType: 'com.acme.approval' },
      { kind: 'cancel_requested', key: executionId, at },
    ]);
  });
});

describe('the time of an input', () => {
  it('never goes back: an input whose clock is behind the last input takes the time of that input', () => {
    const later = { ...runningState, lastInputAt: at + 5000 };

    expect(inputTimeOf(later, started)).toBe(at + 5000);
    expect(inputTimeOf(runningState, { kind: 'cancel_requested', executionId, at: at + 1 })).toBe(at + 1);
    expect([clampedAt(at, at - 1), clampedAt(at, at + 1)]).toEqual([at, at + 1]);
  });

  it('is never before the time a fired timer was due, so a timer that fires early still fires at its time', () => {
    const early: RunInput = { kind: 'timer_fired', executionId, at, timerId: armedTimer };
    const unknown: RunInput = { kind: 'timer_fired', executionId, at, timerId: '9' };

    expect([inputTimeOf(runningState, early), inputTimeOf(runningState, unknown)]).toEqual([at + 60_000, at]);
  });
});
