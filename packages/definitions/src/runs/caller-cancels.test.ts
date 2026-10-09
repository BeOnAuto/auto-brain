import { Conflict, NotFound, RunCancelled } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import type { RunEvent } from './run-events.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const later = '2026-10-01T11:00:00.000Z';

const greeting = { definition_type: 'probe', name: 'plain', input: {} };

const ofPlain = { definition_type: 'probe', name: 'plain', definition_version: 1 };

const started: RunEvent = { type: 'run_started', ...greeting, definition_version: 1, ...start };

const reason = 'The run that waited for it ended first';

const cancelFirst: RunEvent = { type: 'run_cancel_requested', kind: 'parent_ended', reason, ...start };

function stateAfter(...events: readonly RunEvent[]) {
  return events.reduce((state, event) => runDecider.evolve(state, event), runDecider.initialState);
}

function decided(command: RunCommand, ...history: readonly RunEvent[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function cancelling(byItsCaller: boolean): RunCommand {
  return {
    type: 'cancel',
    kind: 'parent_ended',
    reason,
    ...start,
    ...(byItsCaller ? { byItsCaller: true } : {}),
  };
}

const starting: RunCommand = { type: 'start', ...greeting, definition_version: 1, calls_tools: false, ...start };

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
    expect(decided({ type: 'finish', result: { type: 'run_failed' }, ...start }, cancelFirst)).toStrictEqual(
      Result.succeed([]),
    );
    expect(
      decided({ type: 'settle', result: { type: 'run_failed' }, by: 'brain:alpha', at: later }, cancelFirst),
    ).toStrictEqual(Result.fail(new NotFound({ detail: 'There is no such run in this brain' })));
    expect(stateAfter(cancelFirst, cancelFirst)).toStrictEqual({
      cancelledBeforeStart: { kind: 'parent_ended', reason, by: 'acme-admin' },
    });
  });
});

describe('a cancel from the caller of a run within its call', () => {
  const askedOf: RunEvent = {
    type: 'run_cancel_requested',
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
            'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
        }),
      ),
    );
  });

  it('turns the interruption of the run into its cancellation, and an interruption nobody asked for into a failure', () => {
    const interrupted: RunCommand = { type: 'finish', result: { type: 'run_interrupted' }, ...start };

    expect(decided(interrupted, started, askedOf)).toStrictEqual(
      Result.succeed([
        {
          type: 'run_rejected',
          rejection: { reason: 'cancelled', kind: 'parent_ended', detail: reason },
          ...ofPlain,
          ...start,
        },
      ]),
    );
    expect(decided(interrupted, started)).toStrictEqual(Result.succeed([{ type: 'run_failed', ...ofPlain, ...start }]));
  });
});
