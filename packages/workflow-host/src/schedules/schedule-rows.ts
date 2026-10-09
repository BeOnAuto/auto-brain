import { ScheduleTriggerSchema, type ScheduleTrigger } from '@beonauto/definitions';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';

export interface Schedule {
  readonly brainKey: string;
  readonly workflow: string;
  readonly version: number;
  readonly trigger: ScheduleTrigger;
  readonly activatedBy: string;
  readonly activatedAt: number;
  readonly nextDue: number;
  readonly running: string | null;
}

const ScheduleRow = Schema.Struct({
  brain_key: Schema.String,
  workflow: Schema.String,
  version: WholeNumber,
  rule: Schema.fromJsonString(ScheduleTriggerSchema),
  activated_by: Schema.String,
  activated_at: WholeNumber,
  next_due: WholeNumber,
  running: Schema.NullOr(Schema.String),
});

function scheduleOf(row: typeof ScheduleRow.Type): Schedule {
  return {
    brainKey: row.brain_key,
    workflow: row.workflow,
    version: row.version,
    trigger: row.rule,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at,
    nextDue: row.next_due,
    running: row.running,
  };
}

export function dueSchedules(database: HostDatabase, now: number, limit: number): Effect.Effect<readonly Schedule[]> {
  return Effect.orDie(
    rowsOf(
      ScheduleRow,
      Effect.orDie(
        database.read(
          statement`SELECT brain_key, workflow, version, rule, activated_by, activated_at, next_due, running
            FROM workflow_subscriptions
            WHERE kind <> 'event' AND next_due IS NOT NULL AND next_due <= ${now}
            ORDER BY next_due, brain_key, workflow, reference LIMIT ${limit}`,
        ),
      ),
    ),
  ).pipe(Effect.map((rows) => rows.map((row) => scheduleOf(row))));
}

export function nextScheduleDue(database: HostDatabase): Effect.Effect<number | null> {
  return Effect.orDie(
    rowsOf(
      Schema.Struct({ due: Schema.NullOr(WholeNumber) }),
      Effect.orDie(
        database.read(statement`SELECT MIN(next_due) AS due FROM workflow_subscriptions WHERE next_due IS NOT NULL`),
      ),
    ),
  ).pipe(Effect.map((rows) => rows.reduce<number | null>((_, { due }) => due, null)));
}

export function scheduleMovedOn(
  database: HostDatabase,
  { brainKey, workflow, trigger }: Pick<Schedule, 'brainKey' | 'workflow' | 'trigger'>,
  nextDue: number | null,
  running: string | null,
): Effect.Effect<void> {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_subscriptions SET next_due = ${nextDue}, running = ${running}
          WHERE brain_key = ${brainKey} AND workflow = ${workflow} AND reference = ${trigger.reference}`,
      ),
    ),
  );
}
