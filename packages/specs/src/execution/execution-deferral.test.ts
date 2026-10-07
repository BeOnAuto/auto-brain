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

const deferred: ExecutionEvent = { type: 'execution_deferred', record: { run: 'r-1' }, ...ofHandOn, ...start };

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

function settling(result: ExecutionResult, by = 'brain:alpha'): ExecutionCommand {
  return { type: 'settle', result, by, at: later };
}

const starting: ExecutionCommand = { type: 'start', ...greeting, spec_version: 1, calls_tools: false, ...start };

describe('deferring an execution', () => {
  it('records what the primitive started for a started execution', () => {
    expect(decided(finishing({ type: 'execution_deferred', record: { run: 'r-1' } }), started)).toStrictEqual(
      Result.succeed([deferred]),
    );
  });

  it('leaves the execution started, waiting to be settled, and distinct from one that never finished', () => {
    expect(stateAfter(started, deferred)).toMatchObject({ execution: { status: 'started' }, deferred: true });
    expect(stateAfter(started)).toMatchObject({ execution: { status: 'started' }, deferred: false });
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
  it('records the result of a deferred execution, by the actor who settled it', () => {
    expect(decided(settling(success), started, deferred)).toStrictEqual(
      Result.succeed([{ ...success, ...ofHandOn, by: 'brain:alpha', at: later }]),
    );
    expect(decided(settling(success, 'acme-admin'), started, deferred)).toStrictEqual(
      Result.succeed([{ ...success, ...ofHandOn, by: 'acme-admin', at: later }]),
    );
  });

  it('records nothing when it already ended with a settlement of the same key, from any actor', () => {
    const landed: ExecutionEvent = { ...success, ...ofHandOn, ...start };
    const sameOutputInAnotherOrder: ExecutionResult = { ...success, output: 'done', record: { other: true } };
    const cancelled: ExecutionResult = {
      type: 'execution_rejected',
      rejection: { reason: 'cancelled', detail: 'Asked by the caller', kind: 'requested' },
    };

    expect(decided(settling(success, 'acme-admin'), started, deferred, landed)).toStrictEqual(Result.succeed([]));
    expect(decided(settling(sameOutputInAnotherOrder), started, deferred, landed)).toStrictEqual(Result.succeed([]));
    expect(
      decided(
        settling({ ...cancelled, rejection: { ...cancelled.rejection, detail: 'Asked again' } }),
        started,
        deferred,
        { ...cancelled, ...ofHandOn, ...start },
      ),
    ).toStrictEqual(Result.succeed([]));
  });

  it('keys a success by the digest of its output, whatever the order of its keys', () => {
    const landed: ExecutionEvent = { ...success, output: { a: 1, b: [1, { c: 2, d: 3 }] }, ...ofHandOn, ...start };
    const reordered: ExecutionResult = { ...success, output: { b: [1, { d: 3, c: 2 }], a: 1 } };
    const another: ExecutionResult = { ...success, output: { a: 1, b: [{ c: 2, d: 3 }, 1] } };

    expect(decided(settling(reordered), started, deferred, landed)).toStrictEqual(Result.succeed([]));
    expect(decided(settling(another), started, deferred, landed)).toEqual(
      Result.fail(new Conflict({ detail: 'The run already ended with another result' })),
    );
  });
});

describe('a settlement that does not land', () => {
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
      deferred: false,
    });
  });
});

const startedLater: ExecutionEvent = { ...started, finishes_later: true };

describe('a run whose start says it finishes later', () => {
  it('is recorded with that on its start', () => {
    expect(decided({ ...starting, finishes_later: true })).toStrictEqual(Result.succeed([startedLater]));
    expect(stateAfter(startedLater)).toMatchObject({ finishesLater: true, deferred: false });
  });

  it('takes its settlement before its deferral, so a run that ends in its first input settles at once', () => {
    expect(decided(settling(success), startedLater)).toStrictEqual(
      Result.succeed([{ ...success, ...ofHandOn, by: 'brain:alpha', at: later }]),
    );
  });

  it('records no deferral once a result exists, whatever the result', () => {
    const unavailable: ExecutionEvent = { ...unavailability, ...ofHandOn, ...start };

    expect(decided(finishing({ type: 'execution_deferred', record: {} }), startedLater, unavailable)).toStrictEqual(
      Result.succeed([]),
    );
  });

  it('is started again by a call under its id when it never recorded its deferral, as after a crash between the two', () => {
    expect(decided({ ...starting, finishes_later: true }, startedLater)).toStrictEqual(Result.succeed([startedLater]));
    expect(decided({ ...starting, finishes_later: true }, startedLater, deferred)).toStrictEqual(Result.succeed([]));
  });
});

const calledBy = { execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', reference: '/do/0/ask', run: 1 };

describe('a run that answers a call of another run', () => {
  it('records the call and the calls above it on its start, and copies them on every ending', () => {
    const calledStart: ExecutionEvent = { ...startedLater, call_depth: 2, called_by: calledBy };

    expect(decided({ ...starting, finishes_later: true, call_depth: 2, called_by: calledBy })).toStrictEqual(
      Result.succeed([calledStart]),
    );
    expect(decided(settling(success), calledStart)).toStrictEqual(
      Result.succeed([{ ...success, ...ofHandOn, call_depth: 2, called_by: calledBy, by: 'brain:alpha', at: later }]),
    );
    expect(stateAfter(calledStart)).toMatchObject({ callDepth: 2, calledBy });
  });
});

function cancelling(kind: 'requested' | 'deadline' | 'parent_ended' = 'requested'): ExecutionCommand {
  return { type: 'cancel', kind, reason: 'Not needed any more', by: 'acme-admin', at: later };
}

const cancelAsked: ExecutionEvent = {
  type: 'execution_cancel_requested',
  kind: 'requested',
  reason: 'Not needed any more',
  ...ofHandOn,
  by: 'acme-admin',
  at: later,
};

describe('cancelling a run', () => {
  it('records the request with its kind, its reason and who asked, on a run that finishes later', () => {
    expect(decided(cancelling(), started, deferred)).toStrictEqual(Result.succeed([cancelAsked]));
    expect(decided(cancelling('deadline'), startedLater)).toStrictEqual(
      Result.succeed([{ ...cancelAsked, kind: 'deadline' }]),
    );
  });

  it('records nothing more when it was asked before, and leaves the run started until it ends', () => {
    expect(decided(cancelling(), started, deferred, cancelAsked)).toStrictEqual(Result.succeed([]));
    expect(stateAfter(started, deferred, cancelAsked)).toMatchObject({
      execution: { status: 'started' },
      cancel: { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
    });
  });

  it('is refused for a run that ended, one that runs within its call and one the brain does not have', () => {
    expect(decided(cancelling(), started, deferred, { ...success, ...ofHandOn, ...start })).toEqual(
      Result.fail(new Conflict({ detail: 'The run has already ended, so there is nothing left to cancel' })),
    );
    expect(decided(cancelling(), started)).toEqual(
      Result.fail(
        new Conflict({
          detail:
            'The run runs within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
        }),
      ),
    );
    expect(decided(cancelling())).toEqual(Result.fail(new NotFound({ detail: 'There is no such run in this brain' })));
  });

  it('ends as cancelled, a final result for its id that a call with its id answers again', () => {
    const ended: ExecutionEvent = {
      type: 'execution_rejected',
      rejection: { reason: 'cancelled', detail: 'Not needed any more', kind: 'requested' },
      ...ofHandOn,
      by: 'acme-admin',
      at: later,
    };

    expect(decided(starting, started, deferred, cancelAsked, ended)).toStrictEqual(Result.succeed([]));
  });
});
