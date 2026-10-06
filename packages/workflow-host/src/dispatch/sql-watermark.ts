import type { DispatchWatermark } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { runCaughtUp } from '../listeners/listener-rows.ts';
import { streamOfRun } from '../runs/run-address.ts';

const WatermarkRow = Schema.Struct({ dispatched_through: WholeNumber });

const RunRow = Schema.Struct({ run_id: Schema.String });

export function sqlWatermark(database: HostDatabase): DispatchWatermark {
  return {
    read: (runId) =>
      Effect.orDie(
        rowsOf(
          WatermarkRow,
          database.read(statement`SELECT dispatched_through FROM workflow_runs WHERE run_id = ${runId}`),
        ),
      ).pipe(Effect.map(([row]) => row?.dispatched_through ?? 0)),
    advance: (runId, through) =>
      Effect.orDie(
        database.write(
          statement`INSERT INTO workflow_runs (run_id, stream_id, dispatched_through)
            VALUES (${runId}, ${streamOfRun(runId)}, ${through})
            ON CONFLICT (run_id) DO UPDATE SET dispatched_through = excluded.dispatched_through
            WHERE workflow_runs.dispatched_through < excluded.dispatched_through`,
        ),
      ).pipe(Effect.andThen(runCaughtUp(database, runId, through))),
    behindRuns: (limit) =>
      Effect.orDie(
        rowsOf(
          RunRow,
          database.write(
            statement`UPDATE workflow_runs
              SET taken = (
                SELECT COALESCE(MAX(taken), 0) + 1 FROM workflow_runs
                WHERE ended_at IS NULL OR dispatched_through < ended_at
              )
              WHERE run_id IN (
                SELECT run.run_id FROM workflow_runs AS run
                JOIN emt_streams AS stream ON stream.stream_id = run.stream_id AND stream.is_archived = FALSE
                WHERE (run.ended_at IS NULL OR run.dispatched_through < run.ended_at)
                  AND stream.stream_position > run.dispatched_through
                ORDER BY run.taken, run.run_id
                LIMIT ${limit}
              )
              RETURNING run_id`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map(({ run_id: runId }) => runId))),
  };
}
