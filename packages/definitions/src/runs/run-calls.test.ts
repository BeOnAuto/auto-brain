import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallAnsweredFact, CallStartedFact, RunCommand, ToolCallFact } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import type { RunEvent } from './run-events.ts';
import { lastCallOf, startedRunOf } from './run-state.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const finish = { by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started: RunEvent = { type: 'run_started', ...greeting, definition_version: 1, ...start };

const ofGreet = { definition_type: 'echo', name: 'greet', definition_version: 1 };

const succeeded: RunEvent = {
  type: 'run_succeeded',
  output: 'Hello Ada',
  record: {},
  ...ofGreet,
  ...finish,
};

const rejectedInput: RunEvent = {
  type: 'run_rejected',
  rejection: { reason: 'invalid_input', detail: 'No', issues: [] },
  ...ofGreet,
  ...finish,
};

const unavailable: RunEvent = {
  type: 'run_rejected',
  rejection: { reason: 'unavailable', detail: 'The model is busy' },
  ...ofGreet,
  ...finish,
};

const failed: RunEvent = { type: 'run_failed', ...ofGreet, ...finish };

function stateAfter(...events: readonly RunEvent[]) {
  return events.reduce((state, event) => runDecider.evolve(state, event), runDecider.initialState);
}

function decided(command: RunCommand, ...history: readonly RunEvent[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function starting(): RunCommand {
  return { type: 'start', ...greeting, calls_tools: false, definition_version: 1, ...start };
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

function recordingCall(fact: ToolCallFact): RunCommand {
  return { type: 'tool_call', fact, ...during };
}

const callStarted: RunEvent = { ...called, number: 1, ...during };

const callAnswered: RunEvent = { ...answered, ...during };

const deferred: RunEvent = { type: 'run_deferred', record: { run: 'x' }, ...ofGreet, ...during };

const toolsWereCalled = new Conflict({
  detail:
    'The run called tools and did not succeed, so it is not run again under its id, since a tool may have changed something; start a new run with another run id, and read with get_run_history what it called',
  kind: 'tools_called',
});

const toolsOnlyRead = new Conflict({
  detail:
    "The run called tools and did not succeed, so it is not run again under its id; every tool it called only reads, by its server's own account, so nothing was changed: start a new run with another run id, and read with get_run_history what it called",
  kind: 'tools_called',
  because: 'only_read',
});

const readCalled: RunEvent = { ...called, read_only: true, number: 1, ...during };

const noMoreWork = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

describe('a tool call of a run', () => {
  it('is recorded while the run runs, numbered by the decider, with who and when', () => {
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

  it('is refused once the run has ended, however it ended, and before it started', () => {
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

describe('the calls a run recorded', () => {
  it('leave the run started, keeping the number of its last call and that it may have changed something', () => {
    const running = stateAfter(started, callStarted, callAnswered, { ...callStarted, number: 2 });

    expect(running).toMatchObject({ run: { status: 'started' }, lastCall: 2, mayHaveChanged: true });
    expect(stateAfter(started, callStarted, failed)).toMatchObject({
      run: { status: 'failed' },
      lastCall: 1,
      mayHaveChanged: true,
    });
  });

  it('keep the run from running again under its id unless it succeeded or its input was rejected', () => {
    expect(decided(starting(), started, callStarted)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, failed)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, unavailable)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), started, callStarted, rejectedInput)).toStrictEqual(Result.succeed([]));
  });

  it('name no last call for a run that never started', () => {
    expect(lastCallOf(startedRunOf(stateAfter()))).toBe(0);
  });

  it('are counted across a start that was recorded again, so numbers never repeat under one id', () => {
    expect(stateAfter(started, callStarted, started)).toMatchObject({ lastCall: 1, mayHaveChanged: true });
    expect(decided(recordingCall(called), started, callStarted, failed, started)).toStrictEqual(
      Result.succeed([{ ...callStarted, number: 2 }]),
    );
  });
});

describe('the calls of a run whose every tool only reads', () => {
  it('keep the run from running again under its id, saying that nothing was changed once it ended', () => {
    const readAgain = { ...readCalled, number: 2 };

    expect([
      decided(starting(), started, readCalled, readAgain, unavailable),
      decided(starting(), started, readCalled, failed),
      decided(starting(), started, readCalled, callStarted, unavailable),
      decided(starting(), started, readCalled),
    ]).toEqual([
      Result.fail(toolsOnlyRead),
      Result.fail(toolsOnlyRead),
      Result.fail(toolsWereCalled),
      Result.fail(toolsWereCalled),
    ]);
  });

  it('are known after a start recorded again, since each start keeps what the calls before it recorded', () => {
    expect(stateAfter(started, readCalled, failed, started)).toMatchObject({ calledOnlyReadOnly: true });
    expect(stateAfter(started, callStarted, failed, started)).toMatchObject({ calledOnlyReadOnly: false });
  });
});
