import { brainsStreamOfOrg } from '@beonauto/brains';
import { eventAppenderOf, type EventStore } from '@beonauto/ledger';
import { noLineage, type Lineage } from '@beonauto/operations';
import type { Json } from '@beonauto/workflow-engine';
import { Effect, Option, Schema } from 'effect';

import type { Trigger } from '../reactions/reaction-options.ts';
import { TriggerSchema } from '../reactions/subscriptions.ts';

export const alpha = 'brain/acme/alpha/';

export const at = '2026-10-01T09:00:00.000Z';

const AnyRecordSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Json),
]);

type AnyRecord = Readonly<Record<string, Json>> & { readonly type: string };

export interface PublishedEvent {
  readonly id: string;
  readonly type: string;
  readonly data?: Json;
}

export interface SpecVersion {
  readonly name: string;
  readonly version: number;
  readonly trigger: Trigger | undefined;
  readonly when?: string;
}

export async function recorded(store: EventStore, stream: string, record: AnyRecord, lineage: Lineage = noLineage) {
  const { version } = await store.read(stream);
  await Effect.runPromise(eventAppenderOf(store, AnyRecordSchema)(stream, [record], version, lineage));
}

export function published(
  store: EventStore,
  event: PublishedEvent,
  extra: Readonly<Record<string, Json>> = {},
  brainKey = alpha,
) {
  return recorded(store, `${brainKey}events/${event.id}`, {
    type: 'event_published',
    event: { specversion: '1.0', source: '/acme', time: at, ...event },
    filled: [],
    ...extra,
    by: 'acme-admin',
    at,
  });
}

export function publishedInTurn(store: EventStore, events: readonly PublishedEvent[]): Promise<void> {
  return events.reduce<Promise<void>>((before, event) => before.then(() => published(store, event)), Promise.resolve());
}

const decodeTrigger = Schema.decodeUnknownOption(Schema.fromJsonString(TriggerSchema));

export function triggerOfSource(source: string): Trigger | undefined {
  return Option.getOrUndefined(decodeTrigger(source));
}

export type TriggerFilter = Readonly<Record<string, Json>> & { readonly type: string };

export function eventTrigger(...filters: readonly TriggerFilter[]): Trigger {
  return {
    kind: 'events',
    filters: filters.map((attributes, index) => ({
      reference: `/schedule/on/any/${index}`,
      type: attributes.type,
      attributes,
      dataNeedsVariables: false,
    })),
  };
}

export function specRecorded(store: EventStore, { name, version, trigger, when = at }: SpecVersion, brainKey = alpha) {
  const content = trigger === undefined ? { source: 'do: []' } : { source: JSON.stringify(trigger), reacts: true };
  return recorded(store, `${brainKey}specs/orchestration`, {
    type: version === 1 ? 'spec_created' : 'spec_updated',
    name,
    version,
    content,
    by: 'acme-admin',
    at: when,
  });
}

export function specRetired(store: EventStore, name: string) {
  return recorded(store, `${alpha}specs/orchestration`, { type: 'spec_retired', name, by: 'acme-admin', at });
}

export function brainCreated(store: EventStore, brain: string) {
  const created = { type: 'brain_created', brain, name: brain, description: '', by: 'acme-admin', at };
  return recorded(store, brainsStreamOfOrg('acme'), created);
}

export function brainRenamed(store: EventStore, brain: string) {
  return recorded(store, brainsStreamOfOrg('acme'), {
    type: 'brain_updated',
    brain,
    name: 'Renamed',
    by: 'acme-admin',
    at,
  });
}

export interface RunOf {
  readonly executionId: string;
  readonly primitive: string;
  readonly name: string;
  readonly depth?: number;
  readonly correlation?: string;
}

export async function runRecorded(store: EventStore, run: RunOf, ending?: 'execution_succeeded') {
  const { executionId, primitive, name, depth, correlation = executionId } = run;
  const stream = `${alpha}executions/${executionId}`;
  const ofTheRun = { primitive, name, spec_version: 1, ...(depth === undefined ? {} : { depth }) };
  const lineage = { causationId: null, correlationId: correlation };
  await recorded(store, stream, { type: 'execution_started', ...ofTheRun, input: {}, by: 'acme-admin', at }, lineage);
  if (ending !== undefined) {
    await recorded(
      store,
      stream,
      { type: ending, output: 'done', record: {}, ...ofTheRun, by: 'acme-admin', at },
      lineage,
    );
  }
}
