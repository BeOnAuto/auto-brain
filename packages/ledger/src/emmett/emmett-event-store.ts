import { contextOf, messageIdOf, noLineage, type Context, type Lineage } from '@beonauto/operations';
import type { Event, EventStore as EmmettEventStore } from '@event-driven-io/emmett';
import type { Schema } from 'effect';

import type { MessageLineage, RecordedMessage, StreamStore } from '../event-store.ts';
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

type StoredMetadata = Context & {
  readonly messageId: string;
  readonly causationId?: string | null;
  readonly correlationId?: string | null;
};

function lineageOf({ messageId, causationId = null, correlationId = null }: StoredMetadata): MessageLineage {
  return { id: messageId, causationId, correlationId };
}

function metadataOf(messageId: string, { causationId, correlationId }: Lineage, context: Context): StoredMetadata {
  return { messageId, causationId, correlationId, ...context };
}

function recordedMessageOf<Stored extends Record<string, unknown>>(
  data: StoredData<Stored>,
): (event: { readonly type: string; readonly data: Stored; readonly metadata: StoredMetadata }) => RecordedMessage {
  return (event) => ({
    type: event.type,
    data: data.read(event.data),
    context: contextOf(event.metadata),
    lineage: lineageOf(event.metadata),
  });
}

export function emmettEventStore<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  { data, mostEventsInOneAppend, appended = streamAppends }: EmmettEventStoreOptions<Stored>,
): StreamStore {
  const recorded = recordedMessageOf(data);
  return {
    mostEventsInOneAppend,
    read: async (stream, after = 0) => {
      const { currentStreamVersion, events } = await store.readStream<Event<string, Stored, StoredMetadata>>(stream, {
        from: BigInt(after + 1),
      });
      return {
        version: Math.max(after, Number(currentStreamVersion)),
        messages: events.map(
          (event: { readonly type: string; readonly data: Stored; readonly metadata: StoredMetadata }) =>
            recorded(event),
        ),
      };
    },
    append: async (stream, events, { expectedVersion, context, lineage = noLineage }) => {
      await store.appendToStream(
        stream,
        events.map((event, index) => ({
          type: event.type,
          data: data.stored(event.data),
          metadata: metadataOf(messageIdOf(stream, expectedVersion + index + 1), lineage, context),
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
