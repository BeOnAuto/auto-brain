import type { Ledger } from '@beonauto/operations';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import type { Layer } from 'effect';

import type { EventStore } from './event-store.ts';
import { ledgerLayerOver } from './ledger-layer.ts';

type AnyDriver = Parameters<typeof getSQLiteEventStore>[0]['driver'];

export type SQLiteStoreOptions<Driver extends AnyDriver> = Parameters<typeof getSQLiteEventStore<Driver>>[0];

function openSQLiteEventStore<Driver extends AnyDriver>(optionsOf: () => SQLiteStoreOptions<Driver>): EventStore {
  const store = getSQLiteEventStore({ ...optionsOf(), schema: { autoMigration: 'None' } });
  return {
    read: async (stream) => {
      const { currentStreamVersion, events } = await store.readStream(stream);
      return {
        version: Number(currentStreamVersion),
        events: events.map(({ data }: { readonly data: unknown }) => data),
      };
    },
    append: async (stream, events, expectedVersion) => {
      await store.appendToStream(stream, [...events], { expectedStreamVersion: BigInt(expectedVersion) });
    },
    migrate: async () => {
      await store.schema.migrate();
    },
    close: () => store.close(),
  };
}

export function sqliteLedgerLayer<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
): Layer.Layer<Ledger> {
  return ledgerLayerOver(() => openSQLiteEventStore(optionsOf));
}
