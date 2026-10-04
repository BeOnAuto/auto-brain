import { describe, expect, it } from 'vitest';

import { DispatchFailed, outputsAbove, type PositionedEvent, type RunOutput } from '../index.ts';
import { at, executionId, openCall } from '../testing/runs.ts';

const arm: RunOutput = {
  kind: 'arm_timer',
  executionId,
  timerId: `${executionId}/timers/1`,
  dueAt: at + 60_000,
  purpose: 'timeout',
};

const start: RunOutput = { kind: 'start_call', key: openCall, function: 'executeSpec', arguments: {}, longestMs: 600 };

const settle: RunOutput = { kind: 'settle', executionId, settlement: { status: 'failed' } };

function applied(version: number, outputs: readonly RunOutput[]): PositionedEvent {
  return {
    version,
    event: { type: 'input_applied', receipt: { kind: 'timer_fired', key: 'k', at }, patch: [], outputs },
  };
}

describe('the outputs above a watermark', () => {
  it('are those of the events after it, in the order of the stream', () => {
    const events = [applied(3, [settle]), applied(1, [start]), applied(2, [arm, start])];

    expect(outputsAbove(1, events)).toEqual([
      { version: 2, output: arm },
      { version: 2, output: start },
      { version: 3, output: settle },
    ]);
    expect(outputsAbove(3, events)).toEqual([]);
  });
});

describe('a failed dispatch', () => {
  it('names the kind of output that could not be dispatched', () => {
    expect(new DispatchFailed({ output: 'settle', detail: 'the record store did not answer' })).toMatchObject({
      _tag: 'dispatch_failed',
      output: 'settle',
    });
  });
});
