import { reactionRefusalDecider, ReactionRefusedSchema, reactionsStreamKind } from '@beonauto/definitions';
import { decisionLoop, eventAppenderOf } from '@beonauto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { brainOfKey } from '../follower/record-steps.ts';

export interface RefusedWorkflow {
  readonly workflow: string;
  readonly version: number;
}

export interface RefuseReaction {
  readonly refuse: (brainKey: string, refused: RefusedWorkflow, reason: string) => Effect.Effect<void>;
}

export interface Refusals extends RefuseReaction {
  readonly flush: () => Effect.Effect<number>;
}

const RefusalRow = Schema.Struct({
  brain_key: Schema.String,
  workflow: Schema.String,
  version: WholeNumber,
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
  return `${brainKey}${reactionsStreamKind}/${workflow}`;
}

function refusalLoopOn(database: HostDatabase) {
  const append = eventAppenderOf(database.store, ReactionRefusedSchema);
  return decisionLoop(
    (stream: string) =>
      Effect.map(
        Effect.promise(() => database.store.read(stream)),
        ({ version }) => ({ state: null, version }),
      ),
    (stream, events, place) => append(stream, events, place),
    reactionRefusalDecider,
  );
}

function recorded(database: HostDatabase, row: Row, at: number): Effect.Effect<void> {
  const refusal = {
    brain: brainOfKey(row.brain_key),
    workflow: row.workflow,
    version: row.version,
    refused: { count: row.count, reason: row.reason, minute: new Date(row.minute).toISOString() },
    at: new Date(at).toISOString(),
  };
  return Effect.orDie(
    Effect.gen(function* () {
      yield* refusalLoopOn(database)(reactionsStreamOf(row.brain_key, row.workflow), refusal);
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
        statement`SELECT brain_key, workflow, version, minute, count, reason, recorded FROM workflow_reaction_refusals
          WHERE brain_key = ${brainKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map(([row]) => row));
}

interface Counted extends RefusedWorkflow {
  readonly brainKey: string;
  readonly reason: string;
  readonly minute: number;
}

function counted(database: HostDatabase, { brainKey, workflow, version, reason, minute }: Counted) {
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_reaction_refusals (brain_key, workflow, version, minute, count, reason, recorded)
        VALUES (${brainKey}, ${workflow}, ${version}, ${minute}, 1, ${reason}, 0)
        ON CONFLICT (brain_key, workflow) DO UPDATE SET
          count = CASE WHEN workflow_reaction_refusals.minute = excluded.minute
            THEN workflow_reaction_refusals.count + 1 ELSE 1 END,
          version = excluded.version, minute = excluded.minute, reason = excluded.reason, recorded = 0`,
    ),
  );
}

export function refusalsOn(database: HostDatabase, now: () => number): Refusals {
  return {
    refuse: (brainKey, { workflow, version }, reason) =>
      Effect.gen(function* () {
        const at = now();
        const row = yield* rowOf(database, brainKey, workflow);
        if (row !== undefined && row.minute !== minuteOf(at) && row.recorded === 0) {
          yield* recorded(database, row, at);
        }
        yield* counted(database, { brainKey, workflow, version, reason, minute: minuteOf(at) });
      }),
    flush: () =>
      Effect.gen(function* () {
        const at = now();
        const due = yield* Effect.orDie(
          rowsOf(
            RefusalRow,
            database.read(
              statement`SELECT brain_key, workflow, version, minute, count, reason, recorded FROM workflow_reaction_refusals
                WHERE recorded = 0 AND minute < ${minuteOf(at)}`,
            ),
          ),
        );
        yield* Effect.forEach(due, (row) => recorded(database, row, at), { discard: true });
        return due.length;
      }),
  };
}
