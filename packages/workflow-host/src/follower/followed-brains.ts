import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';

export interface Progress {
  readonly cursor: string | null;
  readonly delivered: string | null;
  readonly attempts: number;
  readonly waiting: boolean;
}

export interface FollowedBrain extends Progress {
  readonly brainKey: string;
}

export interface FollowedBrains {
  readonly follow: (brainKey: string, cursor: string | null) => Effect.Effect<void>;
  readonly load: (brainKey: string) => Effect.Effect<FollowedBrain | undefined>;
  readonly save: (brainKey: string, progress: Progress) => Effect.Effect<void>;
  readonly dueForASweep: (limit: number) => Effect.Effect<readonly FollowedBrain[]>;
}

const BrainRow = Schema.Struct({
  brain_key: Schema.String,
  cursor: Schema.NullOr(Schema.String),
  delivered: Schema.NullOr(Schema.String),
  attempts: WholeNumber,
  waiting: WholeNumber,
});

function followedOf(row: typeof BrainRow.Type): FollowedBrain {
  return {
    brainKey: row.brain_key,
    cursor: row.cursor,
    delivered: row.delivered,
    attempts: row.attempts,
    waiting: row.waiting === 1,
  };
}

function loaded(database: HostDatabase, brainKey: string): Effect.Effect<FollowedBrain | undefined> {
  return Effect.orDie(
    rowsOf(
      BrainRow,
      database.read(
        statement`SELECT brain_key, cursor, delivered, attempts, waiting FROM workflow_followed_brains
          WHERE brain_key = ${brainKey}`,
      ),
    ),
  ).pipe(Effect.map(([row]) => (row === undefined ? undefined : followedOf(row))));
}

export function followedBrainsOn(database: HostDatabase): FollowedBrains {
  return {
    follow: (brainKey, cursor) =>
      Effect.asVoid(
        Effect.orDie(
          database.write(
            statement`INSERT INTO workflow_followed_brains (brain_key, cursor) VALUES (${brainKey}, ${cursor})
              ON CONFLICT (brain_key) DO NOTHING`,
          ),
        ),
      ),
    load: (brainKey) => loaded(database, brainKey),
    save: (brainKey, { cursor, delivered, attempts, waiting }) =>
      Effect.asVoid(
        Effect.orDie(
          database.write(
            statement`UPDATE workflow_followed_brains
              SET cursor = ${cursor}, delivered = ${delivered}, attempts = ${attempts}, waiting = ${waiting ? 1 : 0}
              WHERE brain_key = ${brainKey}`,
          ),
        ),
      ),
    dueForASweep: (limit) =>
      Effect.orDie(
        rowsOf(
          BrainRow,
          database.write(
            statement`UPDATE workflow_followed_brains
              SET checked = (SELECT COALESCE(MAX(checked), 0) + 1 FROM workflow_followed_brains)
              WHERE brain_key IN (
                SELECT brain_key FROM workflow_followed_brains ORDER BY waiting DESC, checked, brain_key LIMIT ${limit}
              )
              RETURNING brain_key, cursor, delivered, attempts, waiting`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map((row) => followedOf(row)))),
  };
}
