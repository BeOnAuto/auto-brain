import { recordedReaderOf } from '@beonauto/ledger';
import { messageIdOf, streamPrefixOfBrain, type Conflict } from '@beonauto/operations';
import { cancelRequestOf } from '@beonauto/specs';
import type { CancelOrder, RunInput, Submission } from '@beonauto/workflow-engine';
import { Effect, Schema, type Cause } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { addressOfRun, runIdOf, type RunAddress } from '../runs/run-address.ts';
import { clearedPendingRow, pendingCancelRowsAfter, type PendingCancelRow } from './pending-cancel-rows.ts';

interface PendingCancel {
  readonly cancel: CancelOrder;
  readonly cause: string;
}

const isStart = Schema.is(Schema.Struct({ type: Schema.Literal('execution_started') }));

function isCancelRequest(data: unknown): boolean {
  return cancelRequestOf(data) !== undefined;
}

function pendingCancelOf(database: HostDatabase, run: RunAddress): Effect.Effect<PendingCancel | undefined> {
  const stream = `${streamPrefixOfBrain(run)}executions/${run.executionId}`;
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
      : Effect.asVoid(
          parts.submitted({ kind: 'cancel_requested', executionId: runIdOf(run), at: parts.now(), ...pending }),
        ),
  );
}

type Trouble = (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;

const pendingRowsInAPage = 100;

const cancelsGivenAtOnce = 4;

const finishTypes: ReadonlySet<string> = new Set(['execution_succeeded', 'execution_rejected', 'execution_failed']);

function endedUnstarted(database: HostDatabase, runId: string): Effect.Effect<boolean> {
  const { org, brain, executionId } = addressOfRun(runId);
  return recordedReaderOf(database.store)(
    { org, brain },
    { kind: 'run', execution: executionId },
    { order: 'desc', limit: 1, dataOf: [] },
  ).pipe(
    Effect.orDie,
    Effect.map(({ records: [newest] }) => newest !== undefined && finishTypes.has(newest.type)),
  );
}

function clearedUnlessGoing(database: HostDatabase, runId: string, { outcome }: Submission) {
  if (outcome !== 'not_started') {
    return clearedPendingRow(database, runId);
  }
  return Effect.flatMap(endedUnstarted(database, runId), (ended) =>
    ended ? clearedPendingRow(database, runId) : Effect.void,
  );
}

function givenOrKept(parts: PendingParts, trouble: Trouble, { runId, cause, cancel }: PendingCancelRow) {
  return parts.submitted({ kind: 'cancel_requested', executionId: runId, at: parts.now(), cause, cancel }).pipe(
    Effect.flatMap((submission) => clearedUnlessGoing(parts.database, runId, submission)),
    Effect.as(true),
    Effect.catchCause((failure: Cause.Cause<unknown>) =>
      Effect.as(
        trouble(`The cancel asked of ${runId} could not be given; the next sweep gives it again`, failure),
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
          : Effect.map(pagesGiven(parts, trouble, last.runId), (rest) => allGiven && rest);
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
