import type { Event, EventStore as EmmettEventStore } from '@event-driven-io/emmett';

import type { EncodedEvent, EventStore } from '../event-store.ts';

export interface EmmettStore extends Pick<EmmettEventStore, 'readStream' | 'appendToStream'> {
  readonly schema: { readonly migrate: () => Promise<unknown> };
  readonly close: () => Promise<void>;
}

type JsonText = { readonly json: string };

type EventAsJsonText = Event<string, JsonText>;

const eventsInOneBoundedAppend = 64;

function asJsonText({ type, data }: EncodedEvent): EventAsJsonText {
  return { type, data: { json: JSON.stringify(data) } };
}

function fromJsonText(json: string): unknown {
  return JSON.parse(json);
}

export function jsonTextEventStore(store: EmmettStore): EventStore {
  return {
    mostEventsInOneAppend: eventsInOneBoundedAppend,
    read: async (stream, after = 0) => {
      const { currentStreamVersion, events } = await store.readStream<EventAsJsonText>(stream, {
        from: BigInt(after + 1),
      });
      return {
        version: Math.max(after, Number(currentStreamVersion)),
        events: events.map(({ data }: { readonly data: JsonText }) => fromJsonText(data.json)),
      };
    },
    append: async (stream, events, expectedVersion) => {
      await store.appendToStream(
        stream,
        events.map((event) => asJsonText(event)),
        { expectedStreamVersion: BigInt(expectedVersion) },
      );
    },
    migrate: async () => {
      await store.schema.migrate();
    },
    close: () => store.close(),
  };
}
