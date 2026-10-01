import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ExecutionCommand, ExecutionResult } from './execution-commands.ts';
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

const refused: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'invalid_input', detail: 'No', issues: [{ detail: 'Expected a name', pointer: '/input/who' }] },
  ...finish,
};

const unavailable: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'unavailable', detail: 'The model is busy' },
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
  return { type: 'start', ...greeting, ...request, spec_version: version, ...start };
}

function finishing(result: ExecutionResult): ExecutionCommand {
  return { type: 'finish', result, ...finish };
}

const anotherRequest = new Conflict({
  detail: 'The execution id belongs to an execution of another spec or with another input',
});

describe('starting an execution', () => {
  it('records the spec, its version, the input, who started it and when', () => {
    expect(decided(starting())).toStrictEqual(Result.succeed([started]));
  });

  it('records it again when it never finished, at the version given', () => {
    expect(decided(starting({}, 2), started)).toStrictEqual(Result.succeed([{ ...started, spec_version: 2 }]));
  });

  it('records it again after unavailable or a failure, which are no final result', () => {
    expect(decided(starting(), started, unavailable)).toStrictEqual(Result.succeed([started]));
    expect(decided(starting(), started, failed)).toStrictEqual(Result.succeed([started]));
  });

  it('records nothing once the execution has a final result', () => {
    expect(decided(starting(), started, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), started, refused)).toStrictEqual(Result.succeed([]));
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
    expect(decided(finishing({ type: 'execution_failed' }), started, refused)).toStrictEqual(Result.succeed([]));
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
