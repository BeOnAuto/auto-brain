import { NotFound, SettlementSchema, type Settlement } from '@beonauto/operations';
import type { SettleExecution, Settlement as RecordedSettlement } from '@beonauto/specs';
import { DispatchFailed, type RecordStore, type SettleReceipt } from '@beonauto/workflow-engine';
import { Cause, Effect, Equal, Option, Predicate, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { addressOfRun } from '../runs/run-address.ts';

export const mostSettleAttempts = 20;

const mostDueRunsInOneSweep = 1024;

const settledVersion = Number.MAX_SAFE_INTEGER;

const SettlementText = Schema.fromJsonString(Schema.toCodecJson(SettlementSchema));

const encodeSettlement = Schema.encodeSync(SettlementText);

const SettlementRow = Schema.Struct({ settlement: Schema.NullOr(SettlementText) });

const AttemptsRow = Schema.Struct({ attempts: WholeNumber });

const RunRow = Schema.Struct({ run_id: Schema.String });

function recordedSettlementOf(settlement: Settlement): RecordedSettlement {
  return settlement.status === 'succeeded' ? { ...settlement, record: {} } : settlement;
}

function earlierSettlementOf(database: HostDatabase, runId: string): Effect.Effect<Settlement | null, DatabaseFailed> {
  return rowsOf(
    SettlementRow,
    database.read(statement`SELECT settlement FROM workflow_settlements WHERE run_id = ${runId}`),
  ).pipe(Effect.map(([row]) => row?.settlement ?? null));
}

function recorded(database: HostDatabase, runId: string, settlement: Settlement): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    Effect.all([
      database.write(
        statement`INSERT INTO workflow_settlements (run_id, settlement) VALUES (${runId}, ${encodeSettlement(settlement)})
          ON CONFLICT (run_id) DO UPDATE SET settlement = excluded.settlement`,
      ),
      database.write(
        statement`INSERT INTO workflow_due (run_id, version, next_due_at) VALUES (${runId}, ${settledVersion}, NULL)
          ON CONFLICT (run_id) DO UPDATE SET version = excluded.version, next_due_at = NULL`,
      ),
    ]),
  );
}

function attempted(database: HostDatabase, runId: string): Effect.Effect<number, DatabaseFailed> {
  return oneRowOf(
    AttemptsRow,
    database.write(
      statement`INSERT INTO workflow_settlements (run_id, attempts) VALUES (${runId}, 1)
        ON CONFLICT (run_id) DO UPDATE SET attempts = workflow_settlements.attempts + 1 RETURNING attempts`,
    ),
  ).pipe(Effect.map(({ attempts }) => attempts));
}

function detailOf(failure: unknown): string {
  return Predicate.hasProperty(failure, 'detail') && Predicate.isString(failure.detail)
    ? failure.detail
    : String(failure);
}

function failedAttempt(
  database: HostDatabase,
  runId: string,
  cause: Cause.Cause<unknown>,
): Effect.Effect<SettleReceipt, DatabaseFailed | DispatchFailed> {
  return Effect.flatMap(attempted(database, runId), (attempts) =>
    attempts >= mostSettleAttempts
      ? Effect.succeed('settled_otherwise')
      : Effect.fail(new DispatchFailed({ output: 'settle', detail: detailOf(Cause.squash(cause)) })),
  );
}

function settledFor(
  database: HostDatabase,
  settle: SettleExecution,
  runId: string,
  settlement: Settlement,
): Effect.Effect<SettleReceipt, DatabaseFailed | DispatchFailed> {
  const { org, brain, executionId } = addressOfRun(runId);
  return settle({ org, brain, id: executionId }, recordedSettlementOf(settlement)).pipe(
    Effect.matchCauseEffect({
      onSuccess: () => Effect.as(recorded(database, runId, settlement), 'recorded' as const),
      onFailure: (cause: Cause.Cause<unknown>) =>
        Option.exists(Cause.findErrorOption(cause), (error) => error instanceof NotFound)
          ? Effect.succeed('unknown_execution' as const)
          : failedAttempt(database, runId, cause),
    }),
  );
}

function asDispatchFailure(failure: unknown): DispatchFailed {
  return failure instanceof DispatchFailed
    ? failure
    : new DispatchFailed({ output: 'settle', detail: detailOf(failure) });
}

export function ledgerRecordStore(database: HostDatabase, settle: SettleExecution): RecordStore {
  return {
    settle: ({ executionId: runId, settlement }) =>
      Effect.gen(function* () {
        const earlier = yield* earlierSettlementOf(database, runId);
        if (earlier !== null) {
          return Equal.equals(earlier, settlement) ? 'already_recorded' : 'settled_otherwise';
        }
        return yield* settledFor(database, settle, runId, settlement);
      }).pipe(Effect.mapError(asDispatchFailure)),
    noteDue: ({ executionId: runId, version, nextDueAt }) =>
      Effect.asVoid(
        database.write(
          statement`INSERT INTO workflow_due (run_id, version, next_due_at) VALUES (${runId}, ${version}, ${nextDueAt})
            ON CONFLICT (run_id) DO UPDATE SET version = excluded.version, next_due_at = excluded.next_due_at
            WHERE workflow_due.version <= excluded.version`,
        ),
      ).pipe(
        Effect.mapError(
          ({ detail }: { readonly detail: string }) => new DispatchFailed({ output: 'note_due', detail }),
        ),
      ),
    dueRuns: (before) =>
      Effect.orDie(
        rowsOf(
          RunRow,
          database.read(
            statement`SELECT run_id FROM workflow_due WHERE next_due_at IS NOT NULL AND next_due_at < ${before}
              ORDER BY next_due_at LIMIT ${mostDueRunsInOneSweep}`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map(({ run_id: runId }) => runId))),
  };
}
