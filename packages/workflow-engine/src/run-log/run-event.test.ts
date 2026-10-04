import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  eventBytesOf,
  fitsInOneEvent,
  mostEventBytes,
  newRun,
  RunEventSchema,
  RunInputSchema,
  RunStateSchema,
  stateFormat,
  type RunEvent,
  type RunInput,
} from '../index.ts';
import { at, executionId, openCall, runningState, started } from '../testing/runs.ts';

function asStored<S extends Schema.Codec<unknown, unknown>>(schema: S, value: S['Type']): unknown {
  return JSON.parse(JSON.stringify(Schema.encodeUnknownSync(Schema.toCodecJson(schema))(value)));
}

function readBack<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  stored: unknown,
): Result.Result<S['Type'], unknown> {
  return Schema.decodeUnknownResult(Schema.toCodecJson(schema))(stored);
}

const event: RunEvent = {
  type: 'input_applied',
  format: stateFormat,
  receipt: { kind: 'call_answered', key: 'k', at, status: 'succeeded' },
  steps: [
    { reference: openCall.reference, run: 1, outcome: 'completed' },
    { reference: '/do/2', run: 1, outcome: 'waiting' },
  ],
  patch: [
    { op: 'replace', path: '/machine/context', value: 3 },
    { op: 'add', path: '/timers/armed/e~1timers~13', value: { purpose: 'wait', reference: '/do/2', dueAt: at + 1 } },
    { op: 'remove', path: '/calls/k' },
  ],
  outputs: [
    { kind: 'cancel_timer', executionId, timerId: `${executionId}/timers/2` },
    { kind: 'arm_timer', executionId, timerId: `${executionId}/timers/3`, dueAt: at + 1000, purpose: 'wait' },
    { kind: 'cancel_call', key: openCall },
    { kind: 'settle', executionId, settlement: { status: 'succeeded', output: { approved: true } } },
  ],
};

function near(text: string): RunEvent {
  return { ...event, patch: [{ op: 'replace', path: '/machine/context', value: text }] };
}

const inputs: readonly RunInput[] = [
  started,
  { kind: 'timer_fired', executionId, at, timerId: `${executionId}/timers/1` },
  {
    kind: 'call_answered',
    executionId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'invalid_arguments', detail: 'x' },
  },
  { kind: 'event_received', executionId, at, event: { id: 'event-3', type: 'com.acme.approval', data: [1, 2] } },
  { kind: 'cancel_requested', executionId, at },
];

describe('a run event', () => {
  it('is stored as JSON, naming its state format, and read back as it was decided', () => {
    expect(readBack(RunEventSchema, asStored(RunEventSchema, event))).toEqual(Result.succeed(event));
  });

  it('is refused when it names another state format, or holds an output the engine does not dispatch', () => {
    expect([
      Result.isFailure(readBack(RunEventSchema, { ...event, format: stateFormat + 1 })),
      Result.isFailure(readBack(RunEventSchema, { ...event, outputs: [{ kind: 'send_email', to: 'someone' }] })),
    ]).toEqual([true, true]);
  });

  it('is measured in bytes of UTF-8 JSON, and fits when it takes at most 1.5 MiB', () => {
    const overhead = eventBytesOf(near(''));

    expect(eventBytesOf(near('é'))).toBe(overhead + 2);
    expect(fitsInOneEvent(near('x'.repeat(mostEventBytes - overhead)))).toBe(true);
    expect(fitsInOneEvent(near('x'.repeat(mostEventBytes - overhead + 1)))).toBe(false);
  });
});

describe('a run input', () => {
  it('of each kind is stored as JSON and read back as it was given', () => {
    expect(inputs.map((input) => readBack(RunInputSchema, asStored(RunInputSchema, input)))).toEqual(
      inputs.map((input) => Result.succeed(input)),
    );
  });

  it('is refused for an event without an id, or a time before the epoch', () => {
    expect([
      Result.isFailure(readBack(RunInputSchema, { kind: 'event_received', executionId, at, event: { type: 't' } })),
      Result.isFailure(readBack(RunInputSchema, { kind: 'cancel_requested', executionId, at: -1 })),
    ]).toEqual([true, true]);
  });
});

describe('the state of a run', () => {
  it('is plain JSON, new or running, so a snapshot is the state as it is', () => {
    expect(JSON.parse(JSON.stringify(newRun))).toEqual(newRun);
    expect(JSON.parse(JSON.stringify(runningState))).toEqual(runningState);
    expect(readBack(RunStateSchema, asStored(RunStateSchema, runningState))).toEqual(Result.succeed(runningState));
  });
});
