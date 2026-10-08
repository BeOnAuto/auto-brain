import { Schema } from 'effect';

const ReferenceField = Schema.String.annotate({
  description: 'Where the document names it, such as /schedule/on, /schedule/cron or /schedule/every',
});

const TriggerFilterSchema = Schema.Struct({
  reference: ReferenceField,
  type: Schema.String.annotate({ description: 'The type of the events the filter takes' }),
  attributes: Schema.JsonObject.annotate({
    description: 'What an event must have to match, as written: its type, and its source, subject and data when named',
  }),
});

export const EventTriggerSchema = Schema.Struct({
  kind: Schema.Literal('event'),
  reference: ReferenceField,
  filters: Schema.Array(TriggerFilterSchema).annotate({
    description: 'The filters of the events that start a run; an event that any of them matches starts one',
  }),
});

const CronTriggerSchema = Schema.Struct({
  kind: Schema.Literal('cron'),
  reference: ReferenceField,
  expression: Schema.String.annotate({ description: 'The five fields of its times, read in UTC' }),
});

const EveryTriggerSchema = Schema.Struct({
  kind: Schema.Literal('every'),
  reference: ReferenceField,
  milliseconds: Schema.Int.annotate({ description: 'Its period, counted from when the trigger was saved as it is' }),
});

export const ScheduleTriggerSchema = Schema.Union([CronTriggerSchema, EveryTriggerSchema]);

export const TriggerSchema = Schema.Union([EventTriggerSchema, CronTriggerSchema, EveryTriggerSchema]).annotate({
  description: 'A condition that starts a run on its own: an event trigger, or a cron or every schedule',
});

export type Trigger = typeof TriggerSchema.Type;

export type EventTrigger = Extract<Trigger, { readonly kind: 'event' }>;

export type ScheduleTrigger = Exclude<Trigger, EventTrigger>;

export type TriggerFilter = EventTrigger['filters'][number];

export const TriggerKindSchema = Schema.Literals(['event', 'cron', 'every']);

export const StartingTriggerSchema = Schema.Struct({ kind: TriggerKindSchema, reference: Schema.String });

export type StartingTrigger = typeof StartingTriggerSchema.Type;

export function hasTriggers({ triggers }: { readonly triggers?: readonly Trigger[] }): boolean {
  return triggers !== undefined && triggers.length > 0;
}
