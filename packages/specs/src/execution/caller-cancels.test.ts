import { Conflict, NotFound, RunCancelled } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ExecutionCommand } from './execution-commands.ts';
import { executionDecider } from './execution-decider.ts';
import type { ExecutionEvent } from './execution-events.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const later = '2026-10-01T11:00:00.000Z';

const greeting = { primitive: 'probe', name: 'plain', input: {} };

const ofPlain = { primitive: 'probe', name: 'plain', spec_version: 1 };

const started: ExecutionEvent = { type: 'execution_started', ...greeting, spec_version: 1, ...start };

const reason = 'The run that waited for it ended first';

const cancelFirst: ExecutionEvent = { type: 'execution_cancel_requested', kind: 'parent_ended', reason, ...start };

function stateAfter(...events: readonly ExecutionEvent[]) {
  return events.reduce((state, event) => executionDecider.evolve(state, event), executionDecider.initialState);
}

function decided(command: ExecutionCommand, ...history: readonly ExecutionEvent[]) {
  return executionDecider.decide(command, stateAfter(...history));
}

function cancelling(byItsCaller: boolean): ExecutionCommand {
  return {
    type: 'cancel',
    kind: 'parent_ended',
    reason,
    ...start,
    ...(byItsCaller ? { byItsCaller: true } : {}),
  };
}

const starting: ExecutionCommand = { type: 'start', ...greeting, spec_version: 1, calls_tools: false, ...start };

const cancelledFirst = new RunCancelled({ detail: reason, kind: 'parent_ended' });

describe('a cancel from the caller of a run that has not started', () => {
  it('is recorded as the first event of its stream, without a definition, where a cancel from anyone else finds no run', () => {
    expect(decided(cancelling(true))).toStrictEqual(Result.succeed([cancelFirst]));
    expect(decided(cancelling(false))).toStrictEqual(
      Result.fail(new NotFound({ detail: 'There is no such run in this brain' })),
    );
  });

  it('refuses a start that lands after it, of either kind, as cancelled with its kind and reason', () => {
    expect(decided(starting, cancelFirst)).toStrictEqual(Result.fail(cancelledFirst));
    expect(decided({ ...starting, createOnly: true }, cancelFirst)).toStrictEqual(Result.fail(cancelledFirst));
  });

  it('records nothing more when asked again, and leaves the stream without a run for every other command', () => {
    expect(decided(cancelling(true), cancelFirst)).toStrictEqual(Result.succeed([]));
    expect(decided({ type: 'finish', result: { type: 'execution_failed' }, ...start }, cancelFirst)).toStrictEqual(
      Result.succeed([]),
    );
    expect(
      decided({ type: 'settle', result: { type: 'execution_failed' }, by: 'brain:alpha', at: later }, cancelFirst),
    ).toStrictEqual(Result.fail(new NotFound({ detail: 'There is no such run in this brain' })));
    expect(stateAfter(cancelFirst, cancelFirst)).toStrictEqual({
      cancelledBeforeStart: { kind: 'parent_ended', reason, by: 'acme-admin' },
    });
  });
});

describe('a cancel from the caller of a run within its call', () => {
  const askedOf: ExecutionEvent = {
    type: 'execution_cancel_requested',
    kind: 'parent_ended',
    reason,
    ...ofPlain,
    ...start,
  };

  it('is recorded, where a cancel from anyone else is refused, since nothing outside can interrupt the run', () => {
    expect(decided(cancelling(true), started)).toStrictEqual(Result.succeed([askedOf]));
    expect(decided(cancelling(false), started)).toStrictEqual(
      Result.fail(
        new Conflict({
          detail:
            'The run runs within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
        }),
      ),
    );
  });

  it('turns the interruption of the run into its cancellation, and an interruption nobody asked for into a failure', () => {
    const interrupted: ExecutionCommand = { type: 'finish', result: { type: 'execution_interrupted' }, ...start };

    expect(decided(interrupted, started, askedOf)).toStrictEqual(
      Result.succeed([
        {
          type: 'execution_rejected',
          rejection: { reason: 'cancelled', kind: 'parent_ended', detail: reason },
          ...ofPlain,
          ...start,
        },
      ]),
    );
    expect(decided(interrupted, started)).toStrictEqual(
      Result.succeed([{ type: 'execution_failed', ...ofPlain, ...start }]),
    );
  });
});
