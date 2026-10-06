import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';

export interface ListenerRow {
  readonly runId: string;
  readonly listener: string;
  readonly brainKey: string;
  readonly streamId: string;
  readonly armedBy: number;
  readonly filters: string;
  readonly workflow: string;
  readonly passed: boolean;
}

export interface ListenerPlace {
  readonly runId: string;
  readonly listener: string;
}

const MatchedRow = Schema.Struct({
  run_id: Schema.String,
  listener: Schema.String,
  filters: Schema.String,
  workflow: Schema.String,
});

export type MatchedListener = typeof MatchedRow.Type;

const ArmedRow = Schema.Struct({ armed_by: WholeNumber });

const CountRow = Schema.Struct({ listeners: WholeNumber });

function typesOf(filters: string): readonly string[] {
  const read = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ type: Schema.String }))));
  return [...new Set(read(filters).map(({ type }) => type))];
}

export function insertedListener(database: HostDatabase, row: ListenerRow) {
  return Effect.gen(function* () {
    const { runId, listener, brainKey, streamId, armedBy, filters, workflow, passed } = row;
    yield* database.write(
      statement`INSERT INTO workflow_listeners (run_id, listener, brain_key, stream_id, armed_by, filters, workflow, passed)
        VALUES (${runId}, ${listener}, ${brainKey}, ${streamId}, ${armedBy}, ${filters}, ${workflow}, ${passed ? 1 : 0})
        ON CONFLICT (run_id, listener) DO NOTHING`,
    );
    yield* database.write(
      statement`UPDATE workflow_listeners SET passed = 1
        WHERE run_id = ${runId} AND listener = ${listener} AND passed = 0 AND EXISTS (
          SELECT 1 FROM workflow_passed_runs
          WHERE workflow_passed_runs.run_id = workflow_listeners.run_id
            AND workflow_passed_runs.passed_through >= workflow_listeners.armed_by
        )`,
    );
    yield* Effect.forEach(
      typesOf(filters),
      (type) =>
        database.write(
          statement`INSERT INTO workflow_listener_types (brain_key, type, run_id, listener)
            VALUES (${brainKey}, ${type}, ${runId}, ${listener}) ON CONFLICT DO NOTHING`,
        ),
      { discard: true },
    );
  });
}

export function removedListener(database: HostDatabase, { runId, listener }: ListenerPlace) {
  return Effect.gen(function* () {
    yield* database.write(
      statement`DELETE FROM workflow_listener_types WHERE run_id = ${runId} AND listener = ${listener}`,
    );
    const removed = yield* database.write(
      statement`DELETE FROM workflow_listeners WHERE run_id = ${runId} AND listener = ${listener} RETURNING run_id`,
    );
    return removed.length > 0;
  });
}

export function isListening(database: HostDatabase, { runId, listener }: ListenerPlace) {
  return Effect.map(
    database.read(statement`SELECT run_id FROM workflow_listeners WHERE run_id = ${runId} AND listener = ${listener}`),
    (rows) => rows.length > 0,
  );
}

export function listenersInBrain(database: HostDatabase, brainKey: string) {
  return Effect.map(
    rowsOf(
      CountRow,
      database.read(statement`SELECT count(*) AS listeners FROM workflow_listeners WHERE brain_key = ${brainKey}`),
    ),
    (rows) => rows.reduce((sum, { listeners }) => sum + listeners, 0),
  );
}

export function pendingArmings(database: HostDatabase, streamId: string): Effect.Effect<readonly number[]> {
  return Effect.map(
    Effect.orDie(
      rowsOf(
        ArmedRow,
        database.read(statement`SELECT armed_by FROM workflow_listeners WHERE stream_id = ${streamId} AND passed = 0`),
      ),
    ),
    (rows) => rows.map(({ armed_by: armedBy }) => armedBy),
  );
}

export function runPassedThrough(database: HostDatabase, runId: string, version: number) {
  return Effect.asVoid(
    Effect.orDie(
      database
        .write(
          statement`INSERT INTO workflow_passed_runs (run_id, passed_through)
          SELECT ${runId}, CAST(${version} AS BIGINT)
          WHERE NOT EXISTS (
            SELECT 1 FROM workflow_runs
            WHERE run_id = ${runId} AND (ended_at IS NOT NULL OR dispatched_through >= ${version})
          )
          ON CONFLICT (run_id) DO UPDATE SET passed_through = excluded.passed_through`,
        )
        .pipe(
          Effect.andThen(
            database.write(
              statement`DELETE FROM workflow_passed_runs WHERE run_id = ${runId} AND EXISTS (
              SELECT 1 FROM workflow_runs
              WHERE workflow_runs.run_id = workflow_passed_runs.run_id
                AND (workflow_runs.ended_at IS NOT NULL
                  OR workflow_runs.dispatched_through >= workflow_passed_runs.passed_through)
            )`,
            ),
          ),
        ),
    ),
  );
}

export function runCaughtUp(database: HostDatabase, runId: string, through: number) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_passed_runs WHERE run_id = ${runId} AND passed_through <= ${through}`,
      ),
    ),
  );
}

export function runForgotten(database: HostDatabase, runId: string) {
  return Effect.asVoid(
    Effect.orDie(database.write(statement`DELETE FROM workflow_passed_runs WHERE run_id = ${runId}`)),
  );
}

export function passedListeners(database: HostDatabase, streamId: string, version: number) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_listeners SET passed = 1
          WHERE stream_id = ${streamId} AND passed = 0 AND armed_by <= ${version}`,
      ),
    ),
  );
}

export interface ListenersAsked {
  readonly brainKey: string;
  readonly type: string;
  readonly after: ListenerPlace;
  readonly limit: number;
}

export function listenersOfType(
  database: HostDatabase,
  { brainKey, type, after, limit }: ListenersAsked,
): Effect.Effect<readonly MatchedListener[]> {
  return Effect.orDie(
    rowsOf(
      MatchedRow,
      database.read(
        statement`SELECT l.run_id, l.listener, l.filters, l.workflow
          FROM workflow_listener_types AS t
          JOIN workflow_listeners AS l ON l.run_id = t.run_id AND l.listener = t.listener
          WHERE t.brain_key = ${brainKey} AND t.type = ${type} AND l.passed = 1
            AND (t.run_id > ${after.runId} OR (t.run_id = ${after.runId} AND t.listener > ${after.listener}))
          ORDER BY t.run_id, t.listener
          LIMIT ${limit}`,
      ),
    ),
  );
}
