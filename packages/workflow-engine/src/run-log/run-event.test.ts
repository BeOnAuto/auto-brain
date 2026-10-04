import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { newRun, RunEventSchema, RunInputSchema, RunStateSchema, type RunEvent, type RunInput } from '../index.ts';
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
  receipt: { kind: 'call_answered', key: 'k', at },
  patch: [
    { op: 'replace', path: '/machine/context', value: { approved: true } },
    { op: 'add', path: '/timers/armed/e~1timers~13', value: { purpose: 'wait', reference: '/do/2' } },
    { op: 'remove', path: '/calls/open/k' },
  ],
  outputs: [
    { kind: 'cancel_timer', executionId, timerId: `${executionId}/timers/2` },
    { kind: 'arm_timer', executionId, timerId: `${executionId}/timers/3`, dueAt: at + 1000, purpose: 'wait' },
    { kind: 'cancel_call', key: openCall },
    { kind: 'settle', executionId, settlement: { status: 'succeeded', output: { approved: true } } },
  ],
};

const inputs: readonly RunInput[] = [
  started,
  { kind: 'timer_fired', executionId, at, timerId: `${executionId}/timers/1` },
  {
    kind: 'call_answered',
    executionId,
    at,
    key: openCall,
    result: { status: 'rejected', reason: 'conflict', detail: 'x' },
  },
  { kind: 'event_received', executionId, at, event: { id: 'event-3', type: 'com.acme.approval', data: [1, 2] } },
  { kind: 'cancel_requested', executionId, at },
];

describe('a run event', () => {
  it('is stored as JSON and read back as it was decided', () => {
    expect(readBack(RunEventSchema, asStored(RunEventSchema, event))).toEqual(Result.succeed(event));
  });

  it('is refused when it holds an output the engine does not dispatch', () => {
    const stored = { ...event, outputs: [{ kind: 'send_email', to: 'someone' }] };

    expect(Result.isFailure(readBack(RunEventSchema, stored))).toBe(true);
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
