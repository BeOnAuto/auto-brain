import { cancelRequestOf } from '@beonauto/definitions';
import { recordedReaderOf } from '@beonauto/ledger';
import { messageIdOf, streamPrefixOfBrain, type Conflict } from '@beonauto/operations';
import type { CancelOrder, RunInput, Submission } from '@beonauto/workflow-engine';
import { Effect, Schema, type Cause } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { addressOfRun, runKeyOf, type RunAddress } from '../runs/run-address.ts';
import { clearedPendingRow, pendingCancelRowsAfter, type PendingCancelRow } from './pending-cancel-rows.ts';

interface PendingCancel {
  readonly cancel: CancelOrder;
  readonly cause: string;
}

const isStart = Schema.is(Schema.Struct({ type: Schema.Literal('run_started') }));

function isCancelRequest(data: unknown): boolean {
  return cancelRequestOf(data) !== undefined;
}

function pendingCancelOf(database: HostDatabase, run: RunAddress): Effect.Effect<PendingCancel | undefined> {
  const stream = `${streamPrefixOfBrain(run)}runs/${run.runId}`;
  return Effect.map(
    Effect.promise(() => database.store.read(stream, 0)),
    ({ events }): PendingCancel | undefined => {
      const started = events.findLastIndex((data) => isStart(data));
      const asked = events.findIndex((data, index) => index > started && isCancelRequest(data));
      const request = cancelRequestOf(events[asked]);
      return request === undefined
        ? undefined
        : {
            cancel: { by: request.by, kind: request.kind, reason: request.reason },
            cause: messageIdOf(stream, asked + 1),
          };
    },
  );
}

export interface PendingParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly now: () => number;
}

export function cancelledIfAsked(parts: PendingParts, run: RunAddress): Effect.Effect<void, Conflict> {
  return Effect.flatMap(pendingCancelOf(parts.database, run), (pending) =>
    pending === undefined
      ? Effect.void
      : Effect.asVoid(parts.submitted({ kind: 'cancel_requested', runId: runKeyOf(run), at: parts.now(), ...pending })),
  );
}

type Trouble = (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;

const pendingRowsInAPage = 100;

const cancelsGivenAtOnce = 4;

const finishTypes: ReadonlySet<string> = new Set(['run_succeeded', 'run_rejected', 'run_failed']);

function hasEnded(database: HostDatabase, runKey: string): Effect.Effect<boolean> {
  const { org, brain, runId } = addressOfRun(runKey);
  return recordedReaderOf(database.store)(
    { org, brain },
    { kind: 'run', run: runId },
    { order: 'desc', limit: 1, dataOf: [] },
  ).pipe(
    Effect.orDie,
    Effect.map(({ records: [newest] }) => newest !== undefined && finishTypes.has(newest.type)),
  );
}

function givenToItsRun(parts: PendingParts, { runKey, cause, cancel }: PendingCancelRow) {
  return Effect.flatMap(
    parts.submitted({ kind: 'cancel_requested', runId: runKey, at: parts.now(), cause, cancel }),
    ({ outcome }) => (outcome === 'not_started' ? Effect.void : clearedPendingRow(parts.database, runKey)),
  );
}

function givenOrKept(parts: PendingParts, trouble: Trouble, row: PendingCancelRow) {
  return Effect.flatMap(hasEnded(parts.database, row.runKey), (ended) =>
    ended ? clearedPendingRow(parts.database, row.runKey) : givenToItsRun(parts, row),
  ).pipe(
    Effect.as(true),
    Effect.catchCause((failure: Cause.Cause<unknown>) =>
      Effect.as(
        trouble(`The cancel asked of ${row.runKey} could not be given; the next sweep gives it again`, failure),
        false,
      ),
    ),
  );
}

function pagesGiven(parts: PendingParts, trouble: Trouble, after: string): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.flatMap(pendingCancelRowsAfter(parts.database, after, pendingRowsInAPage), (rows) =>
    Effect.flatMap(
      Effect.forEach(rows, (row) => givenOrKept(parts, trouble, row), { concurrency: cancelsGivenAtOnce }),
      (given: readonly boolean[]) => {
        const allGiven = given.every(Boolean);
        const last = rows.at(-1);
        return last === undefined || rows.length < pendingRowsInAPage
          ? Effect.succeed(allGiven)
          : Effect.map(pagesGiven(parts, trouble, last.runKey), (rest) => allGiven && rest);
      },
    ),
  );
}

export function pendingCancelsGivenOnce(parts: PendingParts, trouble: Trouble): Effect.Effect<void> {
  const given = { once: false };
  return Effect.suspend(() =>
    given.once
      ? Effect.void
      : pagesGiven(parts, trouble, '').pipe(
          Effect.flatMap((allGiven) =>
            Effect.sync(() => {
              given.once = allGiven;
            }),
          ),
          Effect.catchCause((cause: Cause.Cause<unknown>) =>
            trouble('The cancels the follower passed over could not be read; the next sweep reads them again', cause),
          ),
        ),
  );
}
