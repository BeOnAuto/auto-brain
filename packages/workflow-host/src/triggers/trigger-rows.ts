import { EventTriggerSchema, TriggerSchema, type Trigger, type TriggerFilter } from '@beonauto/definitions';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { nextAfter } from '../schedules/schedule-times.ts';
import { triggerChangesOf, type TriggerChange } from './trigger-changes.ts';

export interface Activation {
  readonly workflow: string;
  readonly version: number;
  readonly triggers: readonly Trigger[];
  readonly activatedBy: string;
  readonly activatedAt: number;
}

export interface EventPage {
  readonly type: string;
  readonly after: string | undefined;
  readonly most: number;
}

export interface EventSubscription {
  readonly workflow: string;
  readonly version: number;
  readonly reference: string;
  readonly filters: readonly TriggerFilter[];
}

const KeptRow = Schema.Struct({ rule: Schema.fromJsonString(TriggerSchema) });

const EventRow = Schema.Struct({
  workflow: Schema.String,
  version: WholeNumber,
  rule: Schema.fromJsonString(EventTriggerSchema),
});

function typesKept(database: HostDatabase, brainKey: string, workflow: string, types: readonly string[]) {
  return Effect.orDie(
    Effect.andThen(
      database.write(
        statement`DELETE FROM workflow_subscription_types WHERE brain_key = ${brainKey} AND workflow = ${workflow}`,
      ),
      Effect.forEach(
        [...new Set(types)],
        (type) =>
          database.write(
            statement`INSERT INTO workflow_subscription_types (brain_key, workflow, type)
              VALUES (${brainKey}, ${workflow}, ${type}) ON CONFLICT DO NOTHING`,
          ),
        { discard: true },
      ),
    ),
  );
}

function typesOf(triggers: readonly Trigger[]): readonly string[] {
  return triggers.flatMap((trigger) => (trigger.kind === 'event' ? trigger.filters.map(({ type }) => type) : []));
}

function firstDueOf(trigger: Trigger, activatedAt: number): number | null {
  return trigger.kind === 'event' ? null : nextAfter(trigger, activatedAt, activatedAt);
}

function keptTriggersOf(database: HostDatabase, brainKey: string, workflow: string): Effect.Effect<readonly Trigger[]> {
  return Effect.orDie(
    rowsOf(
      KeptRow,
      database.read(
        statement`SELECT rule FROM workflow_subscriptions WHERE brain_key = ${brainKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.map(({ rule }) => rule)));
}

function activatedRow(database: HostDatabase, brainKey: string, activation: Activation, trigger: Trigger) {
  const { workflow, version, activatedBy, activatedAt } = activation;
  return database.write(
    statement`INSERT INTO workflow_subscriptions
        (brain_key, workflow, reference, version, kind, rule, activated_by, activated_at, next_due, running)
      VALUES (${brainKey}, ${workflow}, ${trigger.reference}, ${version}, ${trigger.kind}, ${JSON.stringify(trigger)},
        ${activatedBy}, ${activatedAt}, ${firstDueOf(trigger, activatedAt)}, NULL)
      ON CONFLICT (brain_key, workflow, reference) DO UPDATE SET version = excluded.version, kind = excluded.kind,
        rule = excluded.rule, activated_by = excluded.activated_by, activated_at = excluded.activated_at,
        next_due = excluded.next_due`,
  );
}

function rowWritten(database: HostDatabase, brainKey: string, activation: Activation, change: TriggerChange) {
  const { workflow, version } = activation;
  if (change.change === 'activated') {
    return activatedRow(database, brainKey, activation, change.trigger);
  }
  return change.change === 'kept'
    ? database.write(
        statement`UPDATE workflow_subscriptions SET version = ${version}
          WHERE brain_key = ${brainKey} AND workflow = ${workflow} AND reference = ${change.trigger.reference}`,
      )
    : database.write(
        statement`DELETE FROM workflow_subscriptions
          WHERE brain_key = ${brainKey} AND workflow = ${workflow} AND reference = ${change.reference}`,
      );
}

export function triggersActivated(database: HostDatabase, brainKey: string, activation: Activation) {
  return Effect.gen(function* () {
    const kept = yield* keptTriggersOf(database, brainKey, activation.workflow);
    yield* Effect.orDie(
      Effect.forEach(
        triggerChangesOf(kept, activation.triggers),
        (change) => rowWritten(database, brainKey, activation, change),
        { discard: true },
      ),
    );
    yield* typesKept(database, brainKey, activation.workflow, typesOf(activation.triggers));
  });
}

export function triggersRemoved(database: HostDatabase, brainKey: string, workflow: string) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`DELETE FROM workflow_subscriptions WHERE brain_key = ${brainKey} AND workflow = ${workflow}`,
      ),
    ),
  ).pipe(Effect.andThen(typesKept(database, brainKey, workflow, [])));
}

export function eventSubscriptionsOf(
  database: HostDatabase,
  brainKey: string,
  { type, after = '', most }: EventPage,
): Effect.Effect<readonly EventSubscription[]> {
  return Effect.orDie(
    rowsOf(
      EventRow,
      Effect.orDie(
        database.read(
          statement`SELECT s.workflow, s.version, s.rule FROM workflow_subscription_types t
            JOIN workflow_subscriptions s ON s.brain_key = t.brain_key AND s.workflow = t.workflow AND s.kind = 'event'
            WHERE t.brain_key = ${brainKey} AND t.type = ${type} AND t.workflow > ${after}
            ORDER BY t.workflow LIMIT ${most + 1}`,
        ),
      ),
    ),
  ).pipe(
    Effect.map((rows) =>
      rows.map(({ workflow, version, rule }) => ({
        workflow,
        version,
        reference: rule.reference,
        filters: rule.filters,
      })),
    ),
  );
}

const TypeRow = Schema.Struct({ type: Schema.String });

export function wantedTypesIn(database: HostDatabase, brainKey: string): Effect.Effect<readonly string[]> {
  return Effect.orDie(
    rowsOf(
      TypeRow,
      database.read(
        statement`SELECT type FROM workflow_subscription_types WHERE brain_key = ${brainKey}
          UNION SELECT type FROM workflow_listener_types WHERE brain_key = ${brainKey}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.map(({ type }) => type)));
}
