import { Conflict, NotFound } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ExecutionCommand, ExecutionOutcome, ExecutionResult } from './execution-commands.ts';
import { executionDecider } from './execution-decider.ts';
import type { ExecutionEvent } from './execution-events.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const later = '2026-10-01T11:00:00.000Z';

const greeting = { primitive: 'relay', name: 'hand-on', input: { who: 'Ada' } };

const started: ExecutionEvent = { type: 'execution_started', ...greeting, spec_version: 1, ...start };

const ofHandOn = { primitive: 'relay', name: 'hand-on', spec_version: 1 };

const deferred: ExecutionEvent = { type: 'execution_deferred', record: { run: 'r-1' }, ...start };

const success: ExecutionResult = { type: 'execution_succeeded', output: 'done', record: { steps: 3 } };

const unavailability: ExecutionResult = {
  type: 'execution_rejected',
  rejection: { reason: 'unavailable', detail: 'The worker is gone' },
};

function stateAfter(...events: readonly ExecutionEvent[]) {
  return events.reduce((state, event) => executionDecider.evolve(state, event), executionDecider.initialState);
}

function decided(command: ExecutionCommand, ...history: readonly ExecutionEvent[]) {
  return executionDecider.decide(command, stateAfter(...history));
}

function finishing(result: ExecutionOutcome): ExecutionCommand {
  return { type: 'finish', result, ...start };
}

function settling(result: ExecutionResult): ExecutionCommand {
  return { type: 'settle', result, at: later };
}

const starting: ExecutionCommand = { type: 'start', ...greeting, spec_version: 1, calls_tools: false, ...start };

describe('deferring an execution', () => {
  it('records what the primitive started for a started execution', () => {
    expect(decided(finishing({ type: 'execution_deferred', record: { run: 'r-1' } }), started)).toStrictEqual(
      Result.succeed([deferred]),
    );
  });

  it('leaves the execution started, waiting to be settled, and distinct from one that never finished', () => {
    expect(stateAfter(started, deferred)).toMatchObject({ execution: { status: 'started' }, finishesLater: true });
    expect(stateAfter(started)).toMatchObject({ execution: { status: 'started' }, finishesLater: false });
  });

  it('keeps a call with its id from starting it again, or finishing it otherwise', () => {
    expect(decided(starting, started, deferred)).toStrictEqual(Result.succeed([]));
    expect(decided(finishing(success), started, deferred)).toStrictEqual(Result.succeed([]));
    expect(decided(finishing({ type: 'execution_deferred', record: {} }), started, deferred)).toStrictEqual(
      Result.succeed([]),
    );
  });
});

describe('settling an execution', () => {
  it('records the result of a deferred execution, by whoever started it', () => {
    expect(decided(settling(success), started, deferred)).toStrictEqual(
      Result.succeed([{ ...success, ...ofHandOn, by: start.by, at: later }]),
    );
  });

  it('records nothing when it already ended with the same result', () => {
    expect(decided(settling(success), started, deferred, { ...success, ...ofHandOn, ...start })).toStrictEqual(
      Result.succeed([]),
    );
  });

  it('is rejected for an execution that ended with another result', () => {
    expect(decided(settling(unavailability), started, deferred, { ...success, ...ofHandOn, ...start })).toEqual(
      Result.fail(new Conflict({ detail: 'The run already ended with another result' })),
    );
  });

  it('is rejected for an execution that runs within its call, and for one the brain does not have', () => {
    expect(decided(settling(success), started)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The run executes within the call that started it, so it cannot be settled' }),
      ),
    );
    expect(decided(settling(success))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no such run in this brain' })),
    );
  });

  it('keeps the record of what was started until a call with its id starts it again', () => {
    const unavailable: ExecutionEvent = { ...unavailability, ...ofHandOn, ...start };

    expect(stateAfter(started, deferred)).toMatchObject({ record: { run: 'r-1' } });
    expect(stateAfter(started, deferred, { ...success, ...ofHandOn, ...start })).toMatchObject({
      record: { steps: 3 },
    });
    expect(stateAfter(started, deferred, unavailable)).toMatchObject({ record: { run: 'r-1' } });
    expect(stateAfter(started, deferred, unavailable, started)).not.toHaveProperty('record');
  });

  it('as unavailable lets a call with its id start it again', () => {
    expect(decided(starting, started, deferred, { ...unavailability, ...ofHandOn, ...start })).toStrictEqual(
      Result.succeed([started]),
    );
    expect(stateAfter(started, deferred, { ...unavailability, ...ofHandOn, ...start }, started)).toMatchObject({
      finishesLater: false,
    });
  });
});
