import { messageIdOf, noLineage, type Lineage } from '@beonauto/operations';
import type { Event, EventStore as EmmettEventStore } from '@event-driven-io/emmett';
import type { Schema } from 'effect';

import type { MessageLineage, StreamStore } from '../event-store.ts';
import { streamAppends, type StreamSignal } from '../signal/append-signal.ts';

export interface EmmettStore extends Pick<EmmettEventStore, 'readStream' | 'appendToStream'> {
  readonly schema: { readonly migrate: () => Promise<unknown> };
  readonly close: () => Promise<void>;
}

export interface StoredData<Stored extends Record<string, unknown>> {
  readonly stored: (data: Schema.JsonObject) => Stored;
  readonly read: (stored: Stored) => unknown;
}

export interface EmmettEventStoreOptions<Stored extends Record<string, unknown>> {
  readonly data: StoredData<Stored>;
  readonly mostEventsInOneAppend: number;
  readonly appended?: StreamSignal;
}

export const dataAsWritten: StoredData<Schema.JsonObject> = {
  stored: (data) => data,
  read: (data) => data,
};

type StoredMetadata = {
  readonly messageId: string;
  readonly causationId?: string | null;
  readonly correlationId?: string | null;
};

function lineageOf({ messageId, causationId = null, correlationId = null }: StoredMetadata): MessageLineage {
  return { id: messageId, causationId, correlationId };
}

function metadataOf(stream: string, position: number, { causationId, correlationId }: Lineage): StoredMetadata {
  return { messageId: messageIdOf(stream, position), causationId, correlationId };
}

export function emmettEventStore<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  { data, mostEventsInOneAppend, appended = streamAppends }: EmmettEventStoreOptions<Stored>,
): StreamStore {
  return {
    mostEventsInOneAppend,
    read: async (stream, after = 0) => {
      const { currentStreamVersion, events } = await store.readStream<Event<string, Stored, StoredMetadata>>(stream, {
        from: BigInt(after + 1),
      });
      return {
        version: Math.max(after, Number(currentStreamVersion)),
        events: events.map((event: { readonly data: Stored }) => data.read(event.data)),
        lineages: events.map((event: { readonly metadata: StoredMetadata }) => lineageOf(event.metadata)),
      };
    },
    append: async (stream, events, expectedVersion, lineage = noLineage) => {
      await store.appendToStream(
        stream,
        events.map((event, index) => ({
          type: event.type,
          data: data.stored(event.data),
          metadata: metadataOf(stream, expectedVersion + index + 1, lineage),
        })),
        { expectedStreamVersion: BigInt(expectedVersion) },
      );
      appended.raise(stream);
    },
    migrate: async () => {
      await store.schema.migrate();
    },
    close: () => store.close(),
  };
}
