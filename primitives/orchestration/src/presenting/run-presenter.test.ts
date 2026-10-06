import { internalTermsIn } from '@beonauto/api/testing';
import { PublicEventSchema, mostPublicEventDataBytes, presentationOf, type RecordedEvent } from '@beonauto/operations';
import {
  RunEventSchema,
  callKeyText,
  mostEventBytes,
  type InputReceipt,
  type RunEvent,
  type RunOutput,
  type Step,
} from '@beonauto/workflow-engine';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { cutAtCodePoint, runPresenter } from './run-presenter.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runId = `acme/alpha/${executionId}`;

const at = Date.parse('2026-10-05T09:00:00.000Z');

const encodeEvent = Schema.encodeSync(Schema.toCodecJson(RunEventSchema));

const decodePublicEvent = Schema.decodeUnknownResult(PublicEventSchema);

const { present } = presentationOf([runPresenter]);

const utf8 = new TextEncoder();

function stepsOf(count: number, reference = '/do/0/notify'): readonly Step[] {
  return Array.from({ length: count }, (_, index) => ({ reference, run: index + 1, outcome: 'completed' }));
}

function eventOf(
  receipt: InputReceipt,
  steps: readonly Step[] = [],
  outputs: readonly RunOutput[] = [],
  patch: RunEvent['patch'] = [],
): RunEvent {
  return { type: 'input_applied', format: 2, receipt, steps, patch, outputs };
}

function recordOf(event: RunEvent): RecordedEvent {
  return {
    id: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    stream: `runs/${executionId}`,
    type: event.type,
    data: encodeEvent(event),
    recordedAt: '2026-10-05T09:00:00.000Z',
  };
}

const settled: RunOutput = { kind: 'settle', executionId: runId, settlement: { status: 'succeeded', output: 1 } };

const armed: RunOutput = { kind: 'arm_timer', executionId: runId, timerId: '2', dueAt: at + 60_000, purpose: 'wait' };

const callKey = { executionId: runId, reference: '/do/0/notify', run: 1 };

describe('an input a workflow took, in the history of its run', () => {
  it('is one public event with the kind and key of the input, its steps, and the kinds of output it made', () => {
    const event = eventOf({ kind: 'started', key: runId, at }, stepsOf(1), [armed, armed]);

    expect(present(recordOf(event))).toEqual({
      id: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
      at: '2026-10-05T09:00:00.000Z',
      type: 'workflow_input_applied',
      summary: 'The workflow started, and 1 step moved.',
      data: {
        execution_id: executionId,
        input: { kind: 'started', key: executionId },
        step_count: 1,
        steps: [{ task: '/do/0/notify', run: 1, outcome: 'completed' }],
        output_kinds: ['arm_timer'],
      },
    });
  });

  it('shows the count of the steps it moved and the first five', () => {
    const event = eventOf({ kind: 'timer_fired', key: '2', at }, stepsOf(7));

    expect(present(recordOf(event))?.data).toMatchObject({
      input: { kind: 'timer_fired', key: '2' },
      step_count: 7,
      steps: stepsOf(5).map(({ reference, run, outcome }) => ({ task: reference, run, outcome })),
    });
  });
});

describe('the words of an input a workflow took', () => {
  it.each([
    [eventOf({ kind: 'started', key: runId, at }), 'The workflow started.'],
    [
      eventOf({ kind: 'timer_fired', key: '2', at }, stepsOf(2)),
      'A timer of the workflow went off, and 2 steps moved.',
    ],
    [
      eventOf({ kind: 'call_answered', key: callKeyText(callKey), at, status: 'succeeded' }, [], [settled]),
      'A function the workflow called answered; the workflow ended.',
    ],
    [
      eventOf({ kind: 'call_answered', key: callKeyText(callKey), at, status: 'unreachable' }),
      'A function the workflow called did not succeed.',
    ],
    [
      eventOf({ kind: 'event_received', key: 'e-1', at, eventType: 'com.acme.approved' }),
      'The workflow received an event.',
    ],
    [
      eventOf({ kind: 'cancel_requested', key: runId, at }, [], [settled]),
      'The workflow was asked to stop; the workflow ended.',
    ],
  ])('says what happened in plain words: %#', (event, summary) => {
    const presented = present(recordOf(event));

    expect(presented?.summary).toBe(summary);
    expect(internalTermsIn(summary)).toEqual([]);
  });
});

describe('an answer or an event a workflow took, in the history of its run', () => {
  it('shows the status of an answer and the type of an event', () => {
    const answered = eventOf({ kind: 'call_answered', key: callKeyText(callKey), at, status: 'failed' });
    const received = eventOf({ kind: 'event_received', key: 'e-1', at, eventType: 'com.acme.approved' });

    expect([present(recordOf(answered))?.data, present(recordOf(received))?.data]).toMatchObject([
      { input: { kind: 'call_answered', key: callKeyText(callKey), status: 'failed' } },
      { input: { kind: 'event_received', key: 'e-1', event_type: 'com.acme.approved' } },
    ]);
  });
});

describe('the largest input a workflow can take', () => {
  it('presents within the bound of public data', () => {
    const awkward = '\u0000'.repeat(256);
    const steps = stepsOf(100, `/do/0/${'😀'.repeat(1024)}`);
    const patch: RunEvent['patch'] = [{ op: 'add', path: '/machine/values/9', value: 'x'.repeat(1_150_000) }];
    const outputs: readonly RunOutput[] = [
      armed,
      { kind: 'cancel_timer', executionId: runId, timerId: '2' },
      { kind: 'start_call', key: callKey, function: 'notify', arguments: {}, longestMs: 1000 },
      { kind: 'cancel_call', key: callKey },
      settled,
    ];
    const event = eventOf({ kind: 'event_received', key: awkward, at, eventType: awkward }, steps, outputs, patch);
    const presented = present(recordOf(event));
    const bytes = utf8.encode(JSON.stringify(event)).byteLength;

    expect([bytes > mostEventBytes - 32_768, bytes <= mostEventBytes]).toEqual([true, true]);
    expect(utf8.encode(JSON.stringify(presented?.data)).byteLength).toBeLessThanOrEqual(mostPublicEventDataBytes);
    expect(Result.isSuccess(decodePublicEvent(presented))).toBe(true);
  });
});

describe('the presenter of the runs of workflows', () => {
  it('decides on every stored type of the log of a run', () => {
    expect(Object.keys(runPresenter.publicNames)).toEqual([RunEventSchema.fields.type.literal]);
  });

  it('cuts a text at a code point, counting its bytes as JSON', () => {
    expect([cutAtCodePoint('a😀b', 3), cutAtCodePoint('a😀b', 5), cutAtCodePoint('\u0000a', 6)]).toEqual([
      'a',
      'a😀',
      '\u0000',
    ]);
  });
});
