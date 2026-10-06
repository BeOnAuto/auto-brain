import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { sqliteEventStore } from '@beonauto/ledger';
import { dumbo } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Effect, Function, Schema } from 'effect';

import { failedWith, type DatabaseFailed, type HostDatabase } from './host-database.ts';
import { armedByAdded, hostTables, timerColumnsOnSQLite } from './host-tables.ts';
import { onSQLite } from './statement.ts';

const pageCacheOfEightMebibytes = -8192;

const modestConnections = { pragmaOptions: { cache_size: pageCacheOfEightMebibytes, mmap_size: 0 } };

const privateMemory = ':memory:';

function prepareDirectoryOf(fileName: string): void {
  if (fileName !== privateMemory) {
    mkdirSync(dirname(fileName), { recursive: true });
  }
}

const ColumnRows = Schema.Array(Schema.Struct({ name: Schema.String }));

function columnsAddedTo(database: HostDatabase): Effect.Effect<void, DatabaseFailed> {
  return Effect.gen(function* () {
    const columns = Schema.decodeUnknownSync(ColumnRows)(yield* database.read(timerColumnsOnSQLite));
    if (!columns.some(({ name }) => name === 'armed_by')) {
      yield* database.write(armedByAdded);
    }
  });
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
    sharedClock: null,
    close: () => store.close(),
  };
  try {
    await store.migrate();
    await Effect.runPromise(Effect.forEach(hostTables, database.write, { discard: true }));
    await Effect.runPromise(columnsAddedTo(database));
    return database;
  } catch (failure) {
    await store.close().catch(Function.constVoid);
    throw failure;
  }
}
