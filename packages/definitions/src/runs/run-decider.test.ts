import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunCommand, RunResult } from './run-commands.ts';
import { runDecider, runStreamNameOf } from './run-decider.ts';
import type { RunEvent } from './run-events.ts';
import { startedRunOf } from './run-state.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const finish = { by: 'acme-admin', at: '2026-10-01T09:00:05.000Z' };

const greeting = { definition_type: 'echo', name: 'greet', input: { who: 'Ada', tags: ['a', 'b'] } };

const started: RunEvent = { type: 'run_started', ...greeting, definition_version: 1, ...start };

const ofGreet = { definition_type: 'echo', name: 'greet', definition_version: 1 };

const succeeded: RunEvent = {
  type: 'run_succeeded',
  output: 'Hello Ada',
  record: { model: 'x' },
  ...ofGreet,
  ...finish,
};

const rejectedInput: RunEvent = {
  type: 'run_rejected',
  rejection: { reason: 'invalid_input', detail: 'No', issues: [{ detail: 'Expected a name', pointer: '/input/who' }] },
  ...ofGreet,
  ...finish,
};

const unavailable: RunEvent = {
  type: 'run_rejected',
  rejection: { reason: 'unavailable', detail: 'The model is busy' },
  ...ofGreet,
  ...finish,
};

const conflicted: RunEvent = {
  type: 'run_rejected',
  rejection: { reason: 'conflict', detail: 'The model takes no seed; update the definition' },
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

function starting(request: object = {}, version = 1): RunCommand {
  return { type: 'start', ...greeting, calls_tools: false, ...request, definition_version: version, ...start };
}

function finishing(result: RunResult): RunCommand {
  return { type: 'finish', result, ...finish };
}

const anotherRequest = new Conflict({
  detail: 'The run id belongs to a run of another definition or with another input',
});

describe('starting a run', () => {
  it('records the definition, its version, the input, who started it and when', () => {
    expect(decided(starting())).toStrictEqual(Result.succeed([started]));
  });

  it('records it again when it never finished, at the version given', () => {
    expect(decided(starting({}, 2), started)).toStrictEqual(Result.succeed([{ ...started, definition_version: 2 }]));
  });

  it('records it again after unavailable, a conflict or a failure, which are no final result', () => {
    expect(decided(starting(), started, unavailable)).toStrictEqual(Result.succeed([started]));
    expect(decided(starting({}, 2), started, conflicted)).toStrictEqual(
      Result.succeed([{ ...started, definition_version: 2 }]),
    );
    expect(decided(starting(), started, failed)).toStrictEqual(Result.succeed([started]));
  });

  it('records nothing once the run has a final result', () => {
    expect(decided(starting(), started, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(starting(), started, rejectedInput)).toStrictEqual(Result.succeed([]));
  });

  it('takes the same input in any key order', () => {
    expect(decided(starting({ input: { tags: ['a', 'b'], who: 'Ada' } }), started, succeeded)).toStrictEqual(
      Result.succeed([]),
    );
  });

  it('is rejected for another capability, another definition or another input under the same id', () => {
    expect(decided(starting({ type: 'probe' }), started)).toEqual(Result.fail(anotherRequest));
    expect(decided(starting({ name: 'wave' }), started, succeeded)).toEqual(Result.fail(anotherRequest));
    expect(decided(starting({ input: { who: 'Bob' } }), started, failed)).toEqual(Result.fail(anotherRequest));
    expect(decided(starting({ input: { who: 'Ada', tags: ['b', 'a'] } }), started)).toEqual(
      Result.fail(anotherRequest),
    );
  });
});

describe('finishing a run', () => {
  it('records how a started run ended, with who finished it and when', () => {
    expect(
      decided(finishing({ type: 'run_succeeded', output: 'Hello Ada', record: { model: 'x' } }), started),
    ).toStrictEqual(Result.succeed([succeeded]));
    expect(decided(finishing({ type: 'run_failed' }), started)).toStrictEqual(Result.succeed([failed]));
  });

  it('records the capability, the name and the version of the definition the latest attempt ran', () => {
    expect(
      decided(finishing({ type: 'run_failed' }), started, unavailable, { ...started, definition_version: 2 }),
    ).toStrictEqual(Result.succeed([{ ...failed, definition_version: 2 }]));
  });

  it('records the result of another attempt after unavailable or a failure', () => {
    expect(
      decided(finishing({ type: 'run_succeeded', output: 'Hello Ada', record: { model: 'x' } }), started, unavailable),
    ).toStrictEqual(Result.succeed([succeeded]));
  });

  it('records nothing once the run has a final result, nor for a run that never started', () => {
    expect(decided(finishing({ type: 'run_failed' }), started, succeeded)).toStrictEqual(Result.succeed([]));
    expect(decided(finishing({ type: 'run_failed' }), started, rejectedInput)).toStrictEqual(Result.succeed([]));
    expect(decided(finishing({ type: 'run_failed' }))).toStrictEqual(Result.succeed([]));
  });
});

describe('a run', () => {
  it('lives in a stream of its own, named after its id', () => {
    expect(runStreamNameOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a')).toBe('runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a');
  });

  it('starts unknown and holds its input and how its latest attempt went', () => {
    expect(stateAfter()).toBeUndefined();
    expect(stateAfter(started, unavailable)).toStrictEqual({
      input: greeting.input,
      run: {
        type: 'echo',
        name: 'greet',
        definition_version: 1,
        status: 'rejected',
        rejection: { reason: 'unavailable', detail: 'The model is busy' },
        started_at: start.at,
        started_by: start.by,
        finished_at: finish.at,
      },
      finishesLater: false,
      deferred: false,
      callsTools: false,
      lastCall: 0,
      mayHaveChanged: false,
      deliveryInFlight: null,
      broughtAnswer: null,
      deliveredAt: null,
      repliesSeen: [],
      replyRefusals: 0,
      depth: 0,
      callDepth: 0,
      result: { type: 'run_rejected', rejection: { reason: 'unavailable', detail: 'The model is busy' } },
    });
  });
});

describe('a run started again', () => {
  it('holds how its latest attempt went, at the version that attempt ran', () => {
    expect(stateAfter(started, unavailable, { ...started, definition_version: 2 }, succeeded)).toStrictEqual({
      input: greeting.input,
      run: {
        type: 'echo',
        name: 'greet',
        definition_version: 2,
        status: 'succeeded',
        output: 'Hello Ada',
        started_at: start.at,
        started_by: start.by,
        finished_at: finish.at,
      },
      finishesLater: false,
      deferred: false,
      callsTools: false,
      lastCall: 0,
      mayHaveChanged: false,
      deliveryInFlight: null,
      broughtAnswer: null,
      deliveredAt: null,
      repliesSeen: [],
      replyRefusals: 0,
      depth: 0,
      callDepth: 0,
      record: { model: 'x' },
      result: { type: 'run_succeeded', output: 'Hello Ada', record: { model: 'x' } },
    });
  });
});

describe('the attempts of a run', () => {
  it('hold a failure without an output or a rejection', () => {
    expect(startedRunOf(stateAfter(started, failed))?.run).toStrictEqual({
      type: 'echo',
      name: 'greet',
      definition_version: 1,
      status: 'failed',
      started_at: start.at,
      started_by: start.by,
      finished_at: finish.at,
    });
  });

  it('are ignored when the run was never seen to start', () => {
    expect(stateAfter(succeeded, failed)).toBeUndefined();
  });
});
