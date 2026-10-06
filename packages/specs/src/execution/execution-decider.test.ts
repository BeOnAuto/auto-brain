import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ExecutionCommand, ExecutionResult, ToolCallFact } from './execution-commands.ts';
import { executionDecider, executionStreamOf } from './execution-decider.ts';
import type { ExecutionEvent } from './execution-events.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const finish = { by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const greeting = { primitive: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started: ExecutionEvent = { type: 'execution_started', ...greeting, spec_version: 1, ...start };

const succeeded: ExecutionEvent = {
  type: 'execution_succeeded',
  output: 'Hello Ada',
  record: { model: 'x' },
  ...finish,
};

const rejectedInput: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'invalid_input', detail: 'No', issues: [{ detail: 'Expected a name', pointer: '/input/who' }] },
  ...finish,
};

const unavailable: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'unavailable', detail: 'The model is busy' },
  ...finish,
};

const conflicted: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'conflict', detail: 'The model takes no seed; update the spec' },
  ...finish,
};

const failed: ExecutionEvent = { type: 'execution_failed', ...finish };

function stateAfter(...events: readonly ExecutionEvent[]) {
  return events.reduce((state, event) => executionDecider.evolve(state, event), executionDecider.initialState);
}

function decided(command: ExecutionCommand, ...history: readonly ExecutionEvent[]) {
  return executionDecider.decide(command, stateAfter(...history));
}

function starting(request: object = {}, version = 1): ExecutionCommand {
  return { type: 'start', ...greeting, calls_tools: false, ...request, spec_version: version, ...start };
}

function finishing(result: ExecutionResult): ExecutionCommand {
  return { type: 'finish', result, ...finish };
}

const anotherRequest = new Conflict({
  detail: 'The run id belongs to a run of another definition or with another input',
});

describe('starting an execution', () => {
  it('records the spec, its version, the input, who started it and when', () => {
    expect(decided(starting())).toStrictEqual(Result.succeed([started]));
  });

  it('records it again when it never finished, at the version given', () => {
    expect(decided(starting({}, 2), started)).toStrictEqual(Result.succeed([{ ...started, spec_version: 2 }]));
  });

  it('records it again after unavailable, a conflict or a failure, which are no final result', () => {
    expect(decided(starting(), started, unavailable)).toStrictEqual(Result.succeed([started]));
    expect(decided(starting({}, 2), started, conflicted)).toStrictEqual(
      Result.succeed([{ ...started, spec_version: 2 }]),
    );
    expect(decided(starting(), started, failed)).toStrictEqual(Result.succeed([started]));
  });

  it('records nothing once the execution has a final result', () => {
    expect(decided(starting(), started, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), started, rejectedInput)).toStrictEqual(Result.succeed([]));
  });

  it('takes the same input in any key order', () => {
    expect(decided(starting({ input: { tags: ['a', 'b'], who: 'Ada' } }), started, succeeded)).toStrictEqual(
      Result.succeed([]),
    );
  });

  it('is rejected for another primitive, another spec or another input under the same id', () => {
    expect(decided(starting({ primitive: 'probe' }), started)).toEqual(Result.fail(anotherRequest));
    expect(decided(starting({ name: 'wave' }), started, succeeded)).toEqual(Result.fail(anotherRequest));
    expect(decided(starting({ input: { who: 'Bob' } }), started, failed)).toEqual(Result.fail(anotherRequest));
    expect(decided(starting({ input: { who: 'Ada', tags: ['b', 'a'] } }), started)).toEqual(
      Result.fail(anotherRequest),
    );
  });
});

describe('finishing an execution', () => {
  it('records how a started execution ended, with who finished it and when', () => {
    expect(
      decided(finishing({ type: 'execution_succeeded', output: 'Hello Ada', record: { model: 'x' } }), started),
    ).toStrictEqual(Result.succeed([succeeded]));
    expect(decided(finishing({ type: 'execution_failed' }), started)).toStrictEqual(Result.succeed([failed]));
  });

  it('records the result of another attempt after unavailable or a failure', () => {
    expect(
      decided(
        finishing({ type: 'execution_succeeded', output: 'Hello Ada', record: { model: 'x' } }),
        started,
        unavailable,
      ),
    ).toStrictEqual(Result.succeed([succeeded]));
  });

  it('records nothing once the execution has a final result, nor for an execution that never started', () => {
    expect(decided(finishing({ type: 'execution_failed' }), started, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(finishing({ type: 'execution_failed' }), started, rejectedInput)).toStrictEqual(Result.succeed([]));
    expect(decided(finishing({ type: 'execution_failed' }))).toStrictEqual(Result.succeed([]));
  });
});

describe('an execution', () => {
  it('lives in a stream of its own, named after its id', () => {
    expect(executionStreamOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a')).toBe(
      'executions/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    );
  });

  it('starts unknown and holds its input and how its latest attempt went', () => {
    expect(stateAfter()).toBeUndefined();
    expect(stateAfter(started, unavailable)).toStrictEqual({
      input: greeting.input,
      execution: {
        primitive: 'echo',
        name: 'greet',
        spec_version: 1,
        status: 'rejected',
        rejection: { reason: 'unavailable', detail: 'The model is busy' },
        started_at: start.at,
        started_by: start.by,
        finished_at: finish.at,
      },
      finishesLater: false,
      callsTools: false,
      toolCalls: 0,
      result: { type: 'execution_rejected', rejection: { reason: 'unavailable', detail: 'The model is busy' } },
    });
    expect(stateAfter(started, unavailable, { ...started, spec_version: 2 }, succeeded)).toStrictEqual({
      input: greeting.input,
      execution: {
        primitive: 'echo',
        name: 'greet',
        spec_version: 2,
        status: 'succeeded',
        output: 'Hello Ada',
        started_at: start.at,
        started_by: start.by,
        finished_at: finish.at,
      },
      finishesLater: false,
      callsTools: false,
      toolCalls: 0,
      record: { model: 'x' },
      result: { type: 'execution_succeeded', output: 'Hello Ada', record: { model: 'x' } },
    });
  });
});

describe('the attempts of an execution', () => {
  it('hold a failure without an output or a rejection', () => {
    expect(stateAfter(started, failed)?.execution).toStrictEqual({
      primitive: 'echo',
      name: 'greet',
      spec_version: 1,
      status: 'failed',
      started_at: start.at,
      started_by: start.by,
      finished_at: finish.at,
    });
  });

  it('are ignored when the execution was never seen to start', () => {
    expect(stateAfter(succeeded, failed)).toBeUndefined();
  });
});

const called: ToolCallFact = {
  type: 'tool_call_started',
  number: 1,
  call_id: 'toolu_01',
  server: 'graph',
  tool: 'search',
  arguments_bytes: 17,
  arguments_sha256: 'a'.repeat(64),
};

const answered: ToolCallFact = {
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

const callStarted: ExecutionEvent = { ...called, ...during };

const callAnswered: ExecutionEvent = { ...answered, ...during };

const toolsWereCalled = new Conflict({
  detail:
    'The run called tools and did not succeed, so it is not run again under its id, since a tool may have changed something; start a new run with another run id, and read with get_execution_history what it called',
  kind: 'tools_called',
});

const noMoreCalls = new Conflict({ detail: 'The run has finished, so it records no more tool calls' });

describe('a tool call of an execution', () => {
  it('is recorded while the execution runs, with who and when', () => {
    expect(decided(recordingCall(called), started)).toStrictEqual(Result.succeed([callStarted]));
    expect(decided(recordingCall(answered), started, callStarted)).toStrictEqual(Result.succeed([callAnswered]));
  });

  it('is refused once the execution has finished, however it ended, and before it started', () => {
    expect(decided(recordingCall(answered), started, callStarted, failed)).toEqual(Result.fail(noMoreCalls));
    expect(decided(recordingCall(called), started, succeeded)).toEqual(Result.fail(noMoreCalls));
    expect(decided(recordingCall(called), started, unavailable)).toEqual(Result.fail(noMoreCalls));
    expect(decided(recordingCall(called))).toEqual(Result.fail(noMoreCalls));
  });

  it('is refused for work that finishes later', () => {
    const deferred: ExecutionEvent = { type: 'execution_deferred', record: { run: 'x' }, ...during };

    expect(decided(recordingCall(called), started, deferred)).toEqual(Result.fail(noMoreCalls));
  });

  it('leaves the execution started, counting its calls, until it finishes', () => {
    const running = stateAfter(started, callStarted, callAnswered, { ...callStarted, number: 2 });

    expect(running).toMatchObject({ execution: { status: 'started' }, toolCalls: 2 });
    expect(stateAfter(started, callStarted, failed)).toMatchObject({ execution: { status: 'failed' }, toolCalls: 1 });
  });

  it('keeps the execution from running again under its id unless it succeeded or its input was rejected', () => {
    expect(decided(starting(), started, callStarted)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, failed)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, unavailable)).toEqual(Result.fail(toolsWereCalled));
    expect(decided(starting(), started, callStarted, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), started, callStarted, rejectedInput)).toStrictEqual(Result.succeed([]));
  });

  it('is counted across a start that was recorded again', () => {
    expect(stateAfter(started, callStarted, started)).toMatchObject({ toolCalls: 1 });
  });
});
