import { CancelOrderSchema, type CancelOrder } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';

export interface PendingCancelRow {
  readonly runId: string;
  readonly cause: string;
  readonly cancel: CancelOrder;
}

const PendingRow = Schema.Struct({
  run_id: Schema.String,
  cause: Schema.String,
  cancelled_by: CancelOrderSchema.fields.by,
  kind: CancelOrderSchema.fields.kind,
  reason: CancelOrderSchema.fields.reason,
});

function pendingOf({ run_id: runId, cause, cancelled_by: by, kind, reason }: typeof PendingRow.Type): PendingCancelRow {
  return { runId, cause, cancel: { by, kind, reason } };
}

export function passedOverRow(
  database: HostDatabase,
  { runId, cause, cancel }: PendingCancelRow,
): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    database.write(
      statement`INSERT INTO workflow_pending_cancels (run_id, cause, cancelled_by, kind, reason)
        VALUES (${runId}, ${cause}, ${cancel.by}, ${cancel.kind}, ${cancel.reason})
        ON CONFLICT (run_id) DO NOTHING`,
    ),
  );
}

export function pendingCancelRowsAfter(
  database: HostDatabase,
  after: string,
  most: number,
): Effect.Effect<readonly PendingCancelRow[], DatabaseFailed> {
  return rowsOf(
    PendingRow,
    database.read(
      statement`SELECT run_id, cause, cancelled_by, kind, reason FROM workflow_pending_cancels
        WHERE run_id > ${after} ORDER BY run_id LIMIT ${most}`,
    ),
  ).pipe(Effect.map((rows) => rows.map((row) => pendingOf(row))));
}

export function clearedPendingRow(database: HostDatabase, runId: string): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(database.write(statement`DELETE FROM workflow_pending_cancels WHERE run_id = ${runId}`));
}
