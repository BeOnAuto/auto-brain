import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { sqliteEventStore } from '@beonauto/ledger';
import { dumbo } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Effect, Function } from 'effect';

import { failedWith, type HostDatabase } from './host-database.ts';
import { hostTables } from './host-tables.ts';
import { onSQLite } from './statement.ts';

const pageCacheOfEightMebibytes = -8192;

const modestConnections = { pragmaOptions: { cache_size: pageCacheOfEightMebibytes, mmap_size: 0 } };

const privateMemory = ':memory:';

function prepareDirectoryOf(fileName: string): void {
  if (fileName !== privateMemory) {
    mkdirSync(dirname(fileName), { recursive: true });
  }
}

export async function openSQLiteDatabase(fileName: string): Promise<HostDatabase> {
  prepareDirectoryOf(fileName);
  const options = { driver: sqlite3EventStoreDriver, fileName, connectionOptions: modestConnections };
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions(options));
  const store = sqliteEventStore(() => ({ ...options, pool }));
  const database: HostDatabase = {
    store,
    read: (statement) =>
      Effect.tryPromise({
        try: async (): Promise<readonly unknown[]> => (await pool.execute.query(onSQLite(statement))).rows,
        catch: failedWith,
      }),
    write: (statement) =>
      Effect.tryPromise({
        try: async (): Promise<readonly unknown[]> => (await pool.execute.command(onSQLite(statement))).rows,
        catch: failedWith,
      }),
    close: () => store.close(),
  };
  try {
    await store.migrate();
    await Effect.runPromise(Effect.forEach(hostTables, database.write, { discard: true }));
    return database;
  } catch (failure) {
    await store.close().catch(Function.constVoid);
    throw failure;
  }
}
