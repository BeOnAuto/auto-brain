import type { Event, EventStore as EmmettEventStore } from '@event-driven-io/emmett';
import type { Schema } from 'effect';

import type { StreamStore } from '../event-store.ts';

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
}

export const dataAsWritten: StoredData<Schema.JsonObject> = {
  stored: (data) => data,
  read: (data) => data,
};

export function emmettEventStore<Stored extends Record<string, unknown>>(
  store: EmmettStore,
  { data, mostEventsInOneAppend }: EmmettEventStoreOptions<Stored>,
): StreamStore {
  return {
    mostEventsInOneAppend,
    read: async (stream, after = 0) => {
      const { currentStreamVersion, events } = await store.readStream<Event<string, Stored>>(stream, {
        from: BigInt(after + 1),
      });
      return {
        version: Math.max(after, Number(currentStreamVersion)),
        events: events.map((event: { readonly data: Stored }) => data.read(event.data)),
      };
    },
    append: async (stream, events, expectedVersion) => {
      await store.appendToStream(
        stream,
        events.map((event) => ({ type: event.type, data: data.stored(event.data) })),
        { expectedStreamVersion: BigInt(expectedVersion) },
      );
    },
    migrate: async () => {
      await store.schema.migrate();
    },
    close: () => store.close(),
  };
}
