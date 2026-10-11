import type { Trigger } from '@beonauto/definitions';
import { eventAppenderOf, type EventStore } from '@beonauto/ledger';
import { messageIdOf, noLineage, type Lineage } from '@beonauto/operations';
import { playbooksStreamOfOrg } from '@beonauto/playbooks';
import type { Json } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';

export const alpha = 'playbook/acme/alpha/';

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

export interface DefinitionVersion {
  readonly name: string;
  readonly version: number;
  readonly triggers: readonly Trigger[];
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
  playbookKey = alpha,
) {
  return recorded(store, `${playbookKey}events/${event.id}`, {
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

export type TriggerFilter = Readonly<Record<string, Json>> & { readonly type: string };

export function eventTrigger(...filters: readonly TriggerFilter[]): Trigger {
  return {
    kind: 'event',
    reference: '/schedule/on',
    filters: filters.map((attributes, index) => ({
      reference: `/schedule/on/any/${index}`,
      type: attributes.type,
      attributes,
    })),
  };
}

export function cronTrigger(expression: string): Trigger {
  return { kind: 'cron', reference: '/schedule/cron', expression };
}

export function everyTrigger(milliseconds: number): Trigger {
  return { kind: 'every', reference: '/schedule/every', milliseconds };
}

export function definitionRecorded(
  store: EventStore,
  { name, version, triggers, when = at }: DefinitionVersion,
  playbookKey = alpha,
) {
  const content = triggers.length === 0 ? { source: 'do: []' } : { source: 'schedule: {}', triggers };
  return recorded(store, `${playbookKey}definitions/workflow`, {
    type: version === 1 ? 'definition_created' : 'definition_updated',
    name,
    version,
    content,
    by: 'acme-admin',
    at: when,
  });
}

export function definitionRecordAt(position: number, playbookKey = alpha): string {
  return messageIdOf(`${playbookKey}definitions/workflow`, position);
}

export function eventRecordOf(id: string, playbookKey = alpha): string {
  return messageIdOf(`${playbookKey}events/${id}`, 1);
}

export function definitionRetired(store: EventStore, name: string) {
  return recorded(store, `${alpha}definitions/workflow`, { type: 'definition_retired', name, by: 'acme-admin', at });
}

export function playbookCreated(store: EventStore, playbook: string) {
  const created = { type: 'playbook_created', playbook, name: playbook, description: '', by: 'acme-admin', at };
  return recorded(store, playbooksStreamOfOrg('acme'), created);
}

export function playbookRenamed(store: EventStore, playbook: string) {
  return recorded(store, playbooksStreamOfOrg('acme'), {
    type: 'playbook_updated',
    playbook,
    name: 'Renamed',
    by: 'acme-admin',
    at,
  });
}

export interface RunOf {
  readonly runId: string;
  readonly type: string;
  readonly name: string;
  readonly depth?: number;
  readonly correlation?: string;
}

export async function runRecorded(store: EventStore, run: RunOf, ending?: 'run_succeeded') {
  const { runId, type, name, depth, correlation = runId } = run;
  const stream = `${alpha}runs/${runId}`;
  const ofTheRun = { definition_type: type, name, definition_version: 1, ...(depth === undefined ? {} : { depth }) };
  const lineage = { causationId: null, correlationId: correlation };
  await recorded(store, stream, { type: 'run_started', ...ofTheRun, input: {}, by: 'acme-admin', at }, lineage);
  if (ending !== undefined) {
    await recorded(
      store,
      stream,
      { type: ending, output: 'done', record: {}, ...ofTheRun, by: 'acme-admin', at },
      lineage,
    );
  }
}
