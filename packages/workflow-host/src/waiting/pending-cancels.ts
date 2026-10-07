import { messageIdOf, streamPrefixOfBrain, type Conflict } from '@beonauto/operations';
import { cancelRequestOf } from '@beonauto/specs';
import type { CancelOrder, RunInput, Submission } from '@beonauto/workflow-engine';
import { Effect, Schema, type Cause } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { addressOfRun, runIdOf, type RunAddress } from '../runs/run-address.ts';

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

const GoingRun = Schema.Struct({ run_id: Schema.String });

export function pendingCancelsGivenOnce(
  parts: PendingParts,
  trouble: (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>,
): Effect.Effect<void> {
  const given = { once: false };
  return Effect.suspend(() =>
    given.once
      ? Effect.void
      : rowsOf(
          GoingRun,
          parts.database.read(statement`SELECT run_id FROM workflow_runs WHERE ended_at IS NULL ORDER BY run_id`),
        ).pipe(
          Effect.flatMap((runs) =>
            Effect.forEach(runs, ({ run_id: runId }) => cancelledIfAsked(parts, addressOfRun(runId)), {
              discard: true,
            }),
          ),
          Effect.andThen(
            Effect.sync(() => {
              given.once = true;
            }),
          ),
          Effect.catchCause((cause: Cause.Cause<unknown>) =>
            trouble('The cancels asked of the runs could not be read; the next sweep reads them again', cause),
          ),
        ),
  );
}
