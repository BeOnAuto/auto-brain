import { eventAppenderOf } from '@beonauto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';

export const ReactionRefusedSchema = Schema.Struct({
  type: Schema.Literal('reaction_refused'),
  workflow: Schema.String,
  count: Schema.Int,
  reason: Schema.String,
  minute: Schema.String,
  at: Schema.String,
});

export type ReactionRefused = typeof ReactionRefusedSchema.Type;

export interface RefuseReaction {
  readonly refuse: (brainKey: string, workflow: string, reason: string) => Effect.Effect<void>;
}

export interface Refusals extends RefuseReaction {
  readonly flush: () => Effect.Effect<number>;
}

const RefusalRow = Schema.Struct({
  brain_key: Schema.String,
  workflow: Schema.String,
  minute: WholeNumber,
  count: WholeNumber,
  reason: Schema.String,
  recorded: WholeNumber,
});

type Row = typeof RefusalRow.Type;

const aMinute = 60_000;

function minuteOf(at: number): number {
  return Math.floor(at / aMinute) * aMinute;
}

export function reactionsStreamOf(brainKey: string, workflow: string): string {
  return `${brainKey}reactions/${workflow}`;
}

function recorded(database: HostDatabase, row: Row, at: number): Effect.Effect<void> {
  const append = eventAppenderOf(database.store, ReactionRefusedSchema);
  const stream = reactionsStreamOf(row.brain_key, row.workflow);
  const refused: ReactionRefused = {
    type: 'reaction_refused',
    workflow: row.workflow,
    count: row.count,
    reason: row.reason,
    minute: new Date(row.minute).toISOString(),
    at: new Date(at).toISOString(),
  };
  return Effect.orDie(
    Effect.gen(function* () {
      const { version } = yield* Effect.promise(() => database.store.read(stream));
      yield* append(stream, [refused], version);
      yield* database.write(
        statement`UPDATE workflow_reaction_refusals SET recorded = 1
          WHERE brain_key = ${row.brain_key} AND workflow = ${row.workflow} AND minute = ${row.minute}`,
      );
    }),
  );
}

function rowOf(database: HostDatabase, brainKey: string, workflow: string): Effect.Effect<Row | undefined> {
  return Effect.orDie(
    rowsOf(
      RefusalRow,
      database.read(
        statement`SELECT brain_key, workflow, minute, count, reason, recorded FROM workflow_reaction_refusals
          WHERE brain_key = ${brainKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map(([row]) => row));
}

interface Counted {
  readonly brainKey: string;
  readonly workflow: string;
  readonly reason: string;
  readonly minute: number;
}

function counted(database: HostDatabase, { brainKey, workflow, reason, minute }: Counted) {
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_reaction_refusals (brain_key, workflow, minute, count, reason, recorded)
        VALUES (${brainKey}, ${workflow}, ${minute}, 1, ${reason}, 0)
        ON CONFLICT (brain_key, workflow) DO UPDATE SET
          count = CASE WHEN workflow_reaction_refusals.minute = excluded.minute
            THEN workflow_reaction_refusals.count + 1 ELSE 1 END,
          minute = excluded.minute, reason = excluded.reason, recorded = 0`,
    ),
  );
}

export function refusalsOn(database: HostDatabase, now: () => number): Refusals {
  return {
    refuse: (brainKey, workflow, reason) =>
      Effect.gen(function* () {
        const at = now();
        const row = yield* rowOf(database, brainKey, workflow);
        if (row !== undefined && row.minute !== minuteOf(at) && row.recorded === 0) {
          yield* recorded(database, row, at);
        }
        yield* counted(database, { brainKey, workflow, reason, minute: minuteOf(at) });
      }),
    flush: () =>
      Effect.gen(function* () {
        const at = now();
        const due = yield* Effect.orDie(
          rowsOf(
            RefusalRow,
            database.read(
              statement`SELECT brain_key, workflow, minute, count, reason, recorded FROM workflow_reaction_refusals
                WHERE recorded = 0 AND minute < ${minuteOf(at)}`,
            ),
          ),
        );
        yield* Effect.forEach(due, (row) => recorded(database, row, at), { discard: true });
        return due.length;
      }),
  };
}
