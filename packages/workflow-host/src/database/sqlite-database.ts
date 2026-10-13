import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { dumbo, type SQL } from '@event-driven-io/dumbo';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { sqliteEventStore, type AppendObserver } from '@on.auto/ledger';
import { Effect, Function, Schema } from 'effect';

import {
  failedWith,
  lastAnswerOf,
  wroteARow,
  type DatabaseFailed,
  type HostDatabase,
  type ReadStatement,
  type StatementAnswer,
} from './host-database.ts';
import { addedColumns, columnsOnSQLite, hostTables, indexesOfAddedColumns, type AddedColumn } from './host-tables.ts';
import { onSQLite, type Statement } from './statement.ts';

const pageCacheOfEightMebibytes = -8192;

const modestConnections = { pragmaOptions: { cache_size: pageCacheOfEightMebibytes, mmap_size: 0 } };

const privateMemory = ':memory:';

function prepareDirectoryOf(fileName: string): void {
  if (fileName !== privateMemory) {
    mkdirSync(dirname(fileName), { recursive: true });
  }
}

const ColumnRows = Schema.Array(Schema.Struct({ name: Schema.String }));

interface WriterTransaction {
  readonly execute: { readonly command: (sql: SQL) => Promise<StatementAnswer> };
}

interface ReaderTransaction {
  readonly execute: { readonly query: (sql: SQL) => Promise<StatementAnswer> };
}

type ReadingTransaction<A> = (transaction: ReaderTransaction) => Promise<{ success: boolean; result: A }>;

type InASnapshot = <A>(handle: ReadingTransaction<A>) => Promise<A>;

interface SnapshotReader {
  readonly withTransaction: <A>(handle: ReadingTransaction<A>, options: typeof deferred) => Promise<A>;
}

const deferred = { mode: 'DEFERRED' } as const;

function readsOn({ execute }: ReaderTransaction): ReadStatement {
  return (statement) =>
    Effect.tryPromise({
      try: async (): Promise<readonly unknown[]> => (await execute.query(onSQLite(statement))).rows,
      catch: failedWith,
    });
}

function consistentReadsIn(inASnapshot: InASnapshot): HostDatabase['readConsistently'] {
  return (reads) =>
    Effect.flatten(
      Effect.tryPromise({
        try: (signal) =>
          inASnapshot(async (transaction) => ({
            success: true,
            result: await Effect.runPromiseExit(reads(readsOn(transaction)), { signal }),
          })),
        catch: failedWith,
      }),
    );
}

function columnAddedTo(
  database: HostDatabase,
  { table, column, added }: AddedColumn,
): Effect.Effect<void, DatabaseFailed> {
  return Effect.gen(function* () {
    const columns = Schema.decodeUnknownSync(ColumnRows)(yield* database.read(columnsOnSQLite(table)));
    if (!columns.some(({ name }) => name === column)) {
      yield* database.write(added);
    }
  });
}

function columnsAddedTo(database: HostDatabase): Effect.Effect<void, DatabaseFailed> {
  return Effect.andThen(
    Effect.forEach(addedColumns, (column) => columnAddedTo(database, column), { discard: true }),
    Effect.forEach(indexesOfAddedColumns, database.write, { discard: true }),
  );
}

export async function openSQLiteDatabase(
  fileName: string,
  tables: readonly Statement[],
  observer?: AppendObserver,
): Promise<HostDatabase> {
  prepareDirectoryOf(fileName);
  const options = { driver: sqlite3EventStoreDriver, fileName, connectionOptions: modestConnections };
  const pool = dumbo(sqlite3EventStoreDriver.mapToDumboOptions(options));
  const store = sqliteEventStore(() => ({ ...options, pool }), {}, observer);
  const inASnapshot: InASnapshot =
    fileName === privateMemory
      ? (handle) => pool.withTransaction(handle, deferred)
      : (handle) =>
          pool.withConnection((reader: SnapshotReader) => reader.withTransaction(handle, deferred), { readonly: true });
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
    transaction: (statements) =>
      Effect.tryPromise({
        try: () =>
          pool.withTransaction(async ({ execute }: WriterTransaction) => {
            const last = await lastAnswerOf(statements, (statement) => execute.command(onSQLite(statement)));
            return { success: wroteARow(last), result: last.rows };
          }),
        catch: failedWith,
      }),
    readConsistently: consistentReadsIn(inASnapshot),
    sharedClock: null,
    close: () => store.close(),
  };
  try {
    await store.migrate();
    await Effect.runPromise(Effect.forEach([...hostTables, ...tables], database.write, { discard: true }));
    await Effect.runPromise(columnsAddedTo(database));
    return database;
  } catch (failure) {
    await store.close().catch(Function.constVoid);
    throw failure;
  }
}
