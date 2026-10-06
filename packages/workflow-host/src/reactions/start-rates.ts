import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { DeliveryFailed, deliverySweeps } from '../follower/consumers.ts';
import type { ReactionStart, StartReaction } from './reaction-options.ts';
import type { Refusals } from './refusals.ts';

export const mostStartsAMinute = 60;

export const mostDeferredStarts = 1000;

const aMinute = 60_000;

const unstarted = 'The workflow could not be started for what it reacts to: ';

export interface Starting {
  readonly start: (brainKey: string, start: ReactionStart) => Effect.Effect<void, DeliveryFailed>;
  readonly startDeferred: () => Effect.Effect<number>;
}

interface StartingParts {
  readonly database: HostDatabase;
  readonly startReaction: StartReaction;
  readonly refusals: Refusals;
}

const ReactionStartSchema = Schema.Struct({
  org: Schema.String,
  brain: Schema.String,
  workflow: Schema.String,
  version: Schema.Int,
  executionId: Schema.String,
  input: Schema.Json,
  depth: Schema.Int,
  cause: Schema.NullOr(Schema.String),
});

const DeferredRow = Schema.Struct({
  brain_key: Schema.String,
  start: Schema.fromJsonString(ReactionStartSchema),
  attempts: WholeNumber,
});

type Deferred = typeof DeferredRow.Type;

const CountRow = Schema.Struct({ deferred: WholeNumber });

function minuteOf(at: number): number {
  return Math.floor(at / aMinute) * aMinute;
}

function admitted(database: HostDatabase, brainKey: string, workflow: string, minute: number) {
  return Effect.orDie(
    database.write(
      statement`INSERT INTO workflow_reaction_rates (brain_key, workflow, minute, starts)
        VALUES (${brainKey}, ${workflow}, ${minute}, 1)
        ON CONFLICT (brain_key, workflow) DO UPDATE SET
          starts = CASE WHEN workflow_reaction_rates.minute = excluded.minute
            THEN workflow_reaction_rates.starts + 1 ELSE 1 END,
          minute = excluded.minute
        WHERE workflow_reaction_rates.minute <> excluded.minute OR workflow_reaction_rates.starts < ${mostStartsAMinute}
        RETURNING starts`,
    ),
  ).pipe(Effect.map((rows) => rows.length > 0));
}

function deferredOf(database: HostDatabase, brainKey: string, workflow: string) {
  return Effect.orDie(
    rowsOf(
      CountRow,
      database.read(
        statement`SELECT count(*) AS deferred FROM workflow_reaction_backlog
          WHERE brain_key = ${brainKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.reduce((sum, { deferred }) => sum + deferred, 0)));
}

function started(
  { startReaction, refusals }: StartingParts,
  brainKey: string,
  start: ReactionStart,
): Effect.Effect<void, DeliveryFailed> {
  return startReaction(start).pipe(
    Effect.catchTag('start_rejected', ({ detail }: Readonly<{ detail: string }>) =>
      refusals.refuse(brainKey, start.workflow, `${unstarted}${detail}`),
    ),
    Effect.mapError(({ detail }: Readonly<{ detail: string }>) => new DeliveryFailed({ detail })),
  );
}

function deferredStart({ database, refusals }: StartingParts, brainKey: string, start: ReactionStart, minute: number) {
  return Effect.flatMap(deferredOf(database, brainKey, start.workflow), (deferred) =>
    deferred >= mostDeferredStarts
      ? refusals.refuse(
          brainKey,
          start.workflow,
          `The workflow was started by its trigger ${mostStartsAMinute} times a minute and ${mostDeferredStarts} starts already waited for a later minute, the most it keeps; this start was refused`,
        )
      : Effect.asVoid(
          Effect.orDie(
            database.write(
              statement`INSERT INTO workflow_reaction_backlog (brain_key, workflow, execution_id, start, due)
                VALUES (${brainKey}, ${start.workflow}, ${start.executionId}, ${JSON.stringify(start)}, ${minute + aMinute})
                ON CONFLICT (brain_key, execution_id) DO NOTHING`,
            ),
          ),
        ),
  );
}

function withoutDeferred(database: HostDatabase, { brain_key: brainKey, start }: Deferred) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_reaction_backlog
          WHERE brain_key = ${brainKey} AND execution_id = ${start.executionId}`,
      ),
    ),
  );
}

function deferredAgain({ database }: StartingParts, deferred: Deferred, minute: number, attempts: number) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_reaction_backlog SET due = ${minute + aMinute}, attempts = ${attempts}
          WHERE brain_key = ${deferred.brain_key} AND execution_id = ${deferred.start.executionId}`,
      ),
    ),
  );
}

function failedWhenDue(parts: StartingParts, deferred: Deferred, minute: number, detail: string) {
  const attempts = deferred.attempts + 1;
  return attempts < deliverySweeps
    ? deferredAgain(parts, deferred, minute, attempts)
    : Effect.andThen(
        parts.refusals.refuse(deferred.brain_key, deferred.start.workflow, `${unstarted}${detail}`),
        withoutDeferred(parts.database, deferred),
      );
}

function startedWhenDue(parts: StartingParts, deferred: Deferred, minute: number) {
  const { brain_key: brainKey, start } = deferred;
  return Effect.flatMap(admitted(parts.database, brainKey, start.workflow, minute), (admits) =>
    admits
      ? started(parts, brainKey, start).pipe(
          Effect.andThen(withoutDeferred(parts.database, deferred)),
          Effect.catch(({ detail }: Readonly<{ detail: string }>) => failedWhenDue(parts, deferred, minute, detail)),
        )
      : deferredAgain(parts, deferred, minute, deferred.attempts),
  );
}

export function startingOn(
  database: HostDatabase,
  startReaction: StartReaction,
  refusals: Refusals,
  now: () => number,
): Starting {
  const parts: StartingParts = { database, startReaction, refusals };
  return {
    start: (brainKey, start) => {
      const minute = minuteOf(now());
      return Effect.flatMap(admitted(database, brainKey, start.workflow, minute), (admits) =>
        admits ? started(parts, brainKey, start) : deferredStart(parts, brainKey, start, minute),
      );
    },
    startDeferred: () =>
      Effect.gen(function* () {
        const minute = minuteOf(now());
        const due = yield* Effect.orDie(
          rowsOf(
            DeferredRow,
            database.read(
              statement`SELECT brain_key, start, attempts FROM workflow_reaction_backlog WHERE due <= ${now()}
                ORDER BY due, execution_id LIMIT ${mostStartsAMinute}`,
            ),
          ),
        );
        yield* Effect.forEach(due, (deferred) => startedWhenDue(parts, deferred, minute), { discard: true });
        return due.length;
      }),
  };
}
