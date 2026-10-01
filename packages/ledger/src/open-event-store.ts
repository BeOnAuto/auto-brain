import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';

import type { EventStore } from './event-store.ts';

export interface LedgerOptions {
  readonly fileName: string;
}

const pageCacheOfEightMebibytes = -8192;

const modestConnections = { pragmaOptions: { cache_size: pageCacheOfEightMebibytes, mmap_size: 0 } };

const privateMemory = ':memory:';

function prepareDirectoryOf(fileName: string): void {
  if (fileName !== privateMemory) {
    mkdirSync(dirname(fileName), { recursive: true });
  }
}

export function openEventStore({ fileName }: LedgerOptions): EventStore {
  prepareDirectoryOf(fileName);
  const store = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName,
    connectionOptions: modestConnections,
    schema: { autoMigration: 'None' },
  });
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
