import { Effect, Schema } from 'effect';

import { oneRowOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';

export const settleAttemptsBeforeBackingOff = 20;

export const settleBackOffMs = 60_000;

const AttemptsRow = Schema.Struct({ attempts: WholeNumber });

export function attempted(database: HostDatabase, runId: string, at: number): Effect.Effect<number, DatabaseFailed> {
  return oneRowOf(
    AttemptsRow,
    database.write(
      statement`INSERT INTO workflow_settlements (run_id, attempts, last_attempt_at) VALUES (${runId}, 1, ${at})
        ON CONFLICT (run_id) DO UPDATE SET attempts = workflow_settlements.attempts + 1,
          last_attempt_at = excluded.last_attempt_at
        RETURNING attempts`,
    ),
  ).pipe(Effect.map(({ attempts }) => attempts));
}

export function isBackingOff(attempts: number, lastAttemptAt: number | null, now: number): boolean {
  return attempts >= settleAttemptsBeforeBackingOff && lastAttemptAt !== null && now - lastAttemptAt < settleBackOffMs;
}

export function backOffLifted(database: HostDatabase, runId: string): Effect.Effect<void, DatabaseFailed> {
  return Effect.asVoid(
    database.write(
      statement`UPDATE workflow_settlements SET last_attempt_at = NULL
        WHERE run_id = ${runId} AND settlement IS NULL`,
    ),
  );
}
