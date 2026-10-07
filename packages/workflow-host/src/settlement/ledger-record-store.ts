import { NotFound, SettlementSchema, type Lineage, type Settlement } from '@beonauto/operations';
import type { SettleExecution } from '@beonauto/specs';
import { DispatchFailed, type RecordStore, type SettleReceipt } from '@beonauto/workflow-engine';
import { Cause, Effect, Equal, Option, Predicate, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import type { HostNote } from '../host/host-reports.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { lineageOfSettlement } from '../runs/run-lineage.ts';
import { attempted, isBackingOff, settleAttemptsBeforeBackingOff, settleBackOffMs } from './settle-attempts.ts';

export interface RecordStoreParts {
  readonly settle: SettleExecution;
  readonly note: (note: HostNote) => Effect.Effect<void>;
  readonly now: () => number;
}

const mostDueRunsInOneSweep = 1024;

const settledVersion = Number.MAX_SAFE_INTEGER;

const SettlementText = Schema.fromJsonString(Schema.toCodecJson(SettlementSchema));

const encodeSettlement = Schema.encodeSync(SettlementText);

const SettlementRow = Schema.Struct({
  settlement: Schema.NullOr(SettlementText),
  attempts: WholeNumber,
  last_attempt_at: Schema.NullOr(WholeNumber),
});

const RunRow = Schema.Struct({ run_id: Schema.String });

type Receipt = Effect.Effect<SettleReceipt, DatabaseFailed | DispatchFailed>;

interface Settling {
  readonly database: HostDatabase;
  readonly parts: RecordStoreParts;
  readonly runId: string;
  readonly settlement: Settlement;
  readonly lineage: Lineage;
}

export function settlementRecorded(
  database: HostDatabase,
  runId: string,
  settlement: Settlement,
): Effect.Effect<void, DatabaseFailed> {
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

function detailOf(failure: unknown): string {
  return Predicate.hasProperty(failure, 'detail') && Predicate.isString(failure.detail)
    ? failure.detail
    : String(failure);
}

function failedAttempt({ database, parts, runId }: Settling, detail: string): Receipt {
  return Effect.gen(function* () {
    const attempts = yield* attempted(database, runId, parts.now());
    if (attempts === settleAttemptsBeforeBackingOff) {
      yield* parts.note({ kind: 'settle_backing_off', run: addressOfRun(runId), attempts, detail });
    }
    return yield* new DispatchFailed({ output: 'settle', detail });
  });
}

function succeeded({ database, parts, runId, settlement }: Settling, attemptsBefore: number): Receipt {
  return Effect.gen(function* () {
    yield* settlementRecorded(database, runId, settlement);
    if (attemptsBefore >= settleAttemptsBeforeBackingOff) {
      yield* parts.note({ kind: 'settled_after_back_off', run: addressOfRun(runId), attempts: attemptsBefore + 1 });
    }
    return 'recorded' as const;
  });
}

function settledFor(settling: Settling, attemptsBefore: number): Receipt {
  const { org, brain, executionId } = addressOfRun(settling.runId);
  const execution = { org, brain, id: executionId };
  return settling.parts.settle(execution, settling.settlement, settling.lineage).pipe(
    Effect.matchCauseEffect({
      onSuccess: () => succeeded(settling, attemptsBefore),
      onFailure: (cause: Cause.Cause<unknown>) =>
        Option.exists(Cause.findErrorOption(cause), (error) => error instanceof NotFound)
          ? Effect.succeed('unknown_execution' as const)
          : failedAttempt(settling, detailOf(Cause.squash(cause))),
    }),
  );
}

function asDispatchFailure(failure: unknown): DispatchFailed {
  return failure instanceof DispatchFailed
    ? failure
    : new DispatchFailed({ output: 'settle', detail: detailOf(failure) });
}

function settledOnce(settling: Settling): Receipt {
  const { database, parts, runId, settlement } = settling;
  return Effect.gen(function* () {
    const [earlier] = yield* rowsOf(
      SettlementRow,
      database.read(
        statement`SELECT settlement, attempts, last_attempt_at FROM workflow_settlements WHERE run_id = ${runId}`,
      ),
    );
    if (earlier !== undefined && earlier.settlement !== null) {
      return Equal.equals(earlier.settlement, settlement) ? 'already_recorded' : 'settled_otherwise';
    }
    const attemptsBefore = earlier?.attempts ?? 0;
    if (isBackingOff(attemptsBefore, earlier?.last_attempt_at ?? null, parts.now())) {
      return yield* new DispatchFailed({
        output: 'settle',
        detail: `The settlement failed ${attemptsBefore} times, so it is tried again once every ${settleBackOffMs} ms`,
      });
    }
    return yield* settledFor(settling, attemptsBefore);
  });
}

export function ledgerRecordStore(database: HostDatabase, parts: RecordStoreParts): RecordStore {
  return {
    settle: ({ executionId: runId, settlement }, run, origin) =>
      settledOnce({ database, parts, runId, settlement, lineage: lineageOfSettlement(run, origin) }).pipe(
        Effect.mapError(asDispatchFailure),
      ),
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
