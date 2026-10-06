import type { LiteralFilter } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { nextAfter } from '../schedules/schedule-times.ts';
import type { Trigger } from './reaction-options.ts';

export interface Activation {
  readonly name: string;
  readonly version: number;
  readonly at: string;
}

export interface EventSubscription {
  readonly workflow: string;
  readonly version: number;
  readonly filters: readonly LiteralFilter[];
}

const EventsTriggerSchema = Schema.Struct({
  kind: Schema.Literal('events'),
  filters: Schema.Array(
    Schema.Struct({
      reference: Schema.String,
      type: Schema.String,
      attributes: Schema.JsonObject,
      dataNeedsVariables: Schema.Boolean,
    }),
  ),
});

export const TimingSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('cron'), expression: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('every'), milliseconds: Schema.Int }),
]);

export const TriggerSchema = Schema.Union([EventsTriggerSchema, ...TimingSchema.members]);

const EventSubscriptionRow = Schema.Struct({
  workflow: Schema.String,
  version: WholeNumber,
  rule: Schema.fromJsonString(EventsTriggerSchema),
});

function firstDueOf(trigger: Trigger, activatedAt: number): number | null {
  return trigger.kind === 'events' ? null : nextAfter(trigger, activatedAt, activatedAt);
}

export function activated(database: HostDatabase, brainKey: string, activation: Activation, trigger: Trigger) {
  const activatedAt = Date.parse(activation.at);
  const rule = JSON.stringify(trigger);
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`INSERT INTO workflow_subscriptions (brain_key, workflow, version, kind, rule, activated_at, next_due, running)
          VALUES (${brainKey}, ${activation.name}, ${activation.version}, ${trigger.kind}, ${rule}, ${activatedAt},
            ${firstDueOf(trigger, activatedAt)}, NULL)
          ON CONFLICT (brain_key, workflow) DO UPDATE SET version = excluded.version, kind = excluded.kind,
            rule = excluded.rule, activated_at = excluded.activated_at, next_due = excluded.next_due, running = NULL
          WHERE workflow_subscriptions.version <> excluded.version`,
      ),
    ),
  );
}

export function deactivated(database: HostDatabase, brainKey: string, workflow: string) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_subscriptions WHERE brain_key = ${brainKey} AND workflow = ${workflow}`,
      ),
    ),
  );
}

export function eventSubscriptionsOf(
  database: HostDatabase,
  brainKey: string,
): Effect.Effect<readonly EventSubscription[]> {
  return Effect.orDie(
    rowsOf(
      EventSubscriptionRow,
      Effect.orDie(
        database.read(
          statement`SELECT workflow, version, rule FROM workflow_subscriptions
            WHERE brain_key = ${brainKey} AND kind = 'events' ORDER BY workflow`,
        ),
      ),
    ),
  ).pipe(
    Effect.map((rows) => rows.map(({ workflow, version, rule }) => ({ workflow, version, filters: rule.filters }))),
  );
}

export function reactsInBrain(database: HostDatabase, brainKey: string): Effect.Effect<boolean> {
  return Effect.map(
    Effect.orDie(
      database.read(
        statement`SELECT 1 AS reacts FROM workflow_subscriptions WHERE brain_key = ${brainKey} AND kind = 'events'
          UNION ALL SELECT 1 AS reacts FROM workflow_listeners WHERE brain_key = ${brainKey}
          LIMIT 1`,
      ),
    ),
    (rows) => rows.length > 0,
  );
}
