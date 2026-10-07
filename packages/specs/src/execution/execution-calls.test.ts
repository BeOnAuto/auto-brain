import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallAnsweredFact, CallStartedFact, ExecutionCommand, ToolCallFact } from './execution-commands.ts';
import { executionDecider } from './execution-decider.ts';
import type { ExecutionEvent } from './execution-events.ts';
import { lastCallOf, runOf } from './execution-state.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const finish = { by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const greeting = { primitive: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started: ExecutionEvent = { type: 'execution_started', ...greeting, spec_version: 1, ...start };

const ofGreet = { primitive: 'echo', name: 'greet', spec_version: 1 };

const succeeded: ExecutionEvent = {
  type: 'execution_succeeded',
  output: 'Hello Ada',
  record: {},
  ...ofGreet,
  ...finish,
};

const rejectedInput: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'invalid_input', detail: 'No', issues: [] },
  ...ofGreet,
  ...finish,
};

const unavailable: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'unavailable', detail: 'The model is busy' },
  ...ofGreet,
  ...finish,
};

const failed: ExecutionEvent = { type: 'execution_failed', ...ofGreet, ...finish };

function stateAfter(...events: readonly ExecutionEvent[]) {
  return events.reduce((state, event) => executionDecider.evolve(state, event), executionDecider.initialState);
}

function decided(command: ExecutionCommand, ...history: readonly ExecutionEvent[]) {
  return executionDecider.decide(command, stateAfter(...history));
}

function starting(): ExecutionCommand {
  return { type: 'start', ...greeting, calls_tools: false, spec_version: 1, ...start };
}

const called: CallStartedFact = {
  type: 'tool_call_started',
  call_id: 'toolu_01',
  server: 'graph',
  tool: 'search',
  arguments_bytes: 17,
  arguments_sha256: 'a'.repeat(64),
};

const answered: CallAnsweredFact = {
  type: 'tool_call_answered',
  number: 1,
  outcome: 'result',
  result_bytes: 42,
  result_sha256: 'b'.repeat(64),
  duration_ms: 120,
  jsonrpc_id: 3,
};

const during = { by: 'acme-admin', at: '2026-10-01T09:00:02.000Z' };

function recordingCall(fact: ToolCallFact): ExecutionCommand {
  return { type: 'tool_call', fact, ...during };
}

const callStarted: ExecutionEvent = { ...called, number: 1, ...during };

const callAnswered: ExecutionEvent = { ...answered, ...during };

const deferred: ExecutionEvent = { type: 'execution_deferred', record: { run: 'x' }, ...ofGreet, ...during };

const toolsWereCalled = new Conflict({
  detail:
    'The run called tools and did not succeed, so it is not run again under its id, since a tool may have changed something; start a new run with another run id, and read with get_execution_history what it called',
  kind: 'tools_called',
});

const noMoreWork = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

describe('a tool call of an execution', () => {
  it('is recorded while the execution runs, numbered by the decider, with who and when', () => {
    expect(decided(recordingCall(called), started)).toStrictEqual(Result.succeed([callStarted]));
    expect(decided(recordingCall(answered), started, callStarted)).toStrictEqual(Result.succeed([callAnswered]));
    expect(decided(recordingCall(called), started, callStarted, callAnswered)).toStrictEqual(
      Result.succeed([{ ...callStarted, number: 2 }]),
    );
  });

  it('takes the number a call names only when it is the next, so a call repeated under its number is refused', () => {
    expect(decided(recordingCall({ ...called, number: 2 }), started, callStarted)).toStrictEqual(
      Result.succeed([{ ...callStarted, number: 2 }]),
    );
    expect(decided(recordingCall({ ...called, number: 1 }), started, callStarted)).toEqual(
      Result.fail(
        new Conflict({
          detail:
            'The run records its calls in order, and call 1 is not its next call, 2; another attempt recorded it first',
        }),
      ),
    );
  });

  it('is refused once the execution has ended, however it ended, and before it started', () => {
    expect(decided(recordingCall(answered), started, callStarted, failed)).toEqual(Result.fail(noMoreWork));
    expect(decided(recordingCall(called), started, succeeded)).toEqual(Result.fail(noMoreWork));
    expect(decided(recordingCall(called), started, unavailable)).toEqual(Result.fail(noMoreWork));
    expect(decided(recordingCall(called))).toEqual(Result.fail(noMoreWork));
  });

  it('is taken as the work of a run that finishes later, until it is settled', () => {
    expect(decided(recordingCall(called), started, deferred)).toStrictEqual(Result.succeed([callStarted]));
    expect(decided(recordingCall(called), started, deferred, failed)).toEqual(Result.fail(noMoreWork));
  });
});

describe('the calls an execution recorded', () => {
  it('leave the execution started, keeping the number of its last call and that it may have changed something', () => {
    const running = stateAfter(started, callStarted, callAnswered, { ...callStarted, number: 2 });

    expect(running).toMatchObject({ execution: { status: 'started' }, lastCall: 2, mayHaveChanged: true });
    expect(stateAfter(started, callStarted, failed)).toMatchObject({
      execution: { status: 'failed' },
      lastCall: 1,
      mayHaveChanged: true,
    });
  });

  it('keep the execution from running again under its id unless it succeeded or its input was rejected', () => {
    expect(decided(starting(), started, callStarted)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, failed)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, unavailable)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), started, callStarted, rejectedInput)).toStrictEqual(Result.succeed([]));
  });

  it('name no last call for a run that never started', () => {
    expect(lastCallOf(runOf(stateAfter()))).toBe(0);
  });

  it('are counted across a start that was recorded again, so numbers never repeat under one id', () => {
    expect(stateAfter(started, callStarted, started)).toMatchObject({ lastCall: 1, mayHaveChanged: true });
    expect(decided(recordingCall(called), started, callStarted, failed, started)).toStrictEqual(
      Result.succeed([{ ...callStarted, number: 2 }]),
    );
  });
});
