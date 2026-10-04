import { describe, expect, it } from 'vitest';

import { callKeyText, clampedAt, receiptOf, type RunInput } from '../index.ts';
import { armedTimer, at, executionId, openCall, started } from '../testing/runs.ts';

const inputs: readonly RunInput[] = [
  started,
  { kind: 'timer_fired', executionId, at, timerId: armedTimer },
  { kind: 'call_answered', executionId, at, key: openCall, result: { status: 'failed', detail: 'boom' } },
  { kind: 'event_received', executionId, at, event: { id: 'event-9', type: 'com.acme.approval' } },
  { kind: 'cancel_requested', executionId, at },
];

describe('the receipt of an input', () => {
  it('names the input by the key it is deduplicated by, with the status of an answer or the type of an event', () => {
    expect(inputs.map((input) => receiptOf(input, 0))).toEqual([
      { kind: 'started', key: executionId, at },
      { kind: 'timer_fired', key: armedTimer, at },
      { kind: 'call_answered', key: callKeyText(openCall), at, status: 'failed' },
      { kind: 'event_received', key: 'event-9', at, eventType: 'com.acme.approval' },
      { kind: 'cancel_requested', key: executionId, at },
    ]);
  });

  it('never goes back in time: an input whose clock is behind the last input takes the time of that input', () => {
    expect(receiptOf(started, at + 5000).at).toBe(at + 5000);
    expect([clampedAt(at, at - 1), clampedAt(at, at + 1)]).toEqual([at, at + 1]);
  });
});
