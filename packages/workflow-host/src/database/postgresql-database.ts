import type { EventStore } from '@beonauto/ledger';
import { postgresqlEventStore } from '@beonauto/ledger/postgresql';
import { Effect, Function, Schema } from 'effect';
import { Pool } from 'pg';

import {
  failedWith,
  lastAnswerOf,
  oneRowOf,
  WholeNumber,
  wroteARow,
  type HostDatabase,
  type StatementAnswer,
} from './host-database.ts';
import { addedColumns, hostTables, indexesOfAddedColumns } from './host-tables.ts';
import { statement, textOnPostgreSQL, type Statement, type StatementValue } from './statement.ts';

export interface PostgreSQLDatabaseOptions {
  readonly connectionString: string;
  readonly reportLostConnection: (error: Readonly<Error>) => void;
  readonly tables: readonly Statement[];
}

export interface Connection {
  query(text: string, values?: readonly StatementValue[]): Promise<StatementAnswer>;
  release(): void;
}

export interface Connections {
  query(text: string, values: readonly StatementValue[]): Promise<StatementAnswer>;
  connect(): Promise<Connection>;
  end(): Promise<void>;
}

const connectionsForTheHostTables = 4;

const migrationLock = 7_461_239_041;

const NowRow = Schema.Struct({ now: WholeNumber });

function alwaysKept(): boolean {
  return true;
}

async function inTransaction(
  connections: Connections,
  statements: readonly Statement[],
  isKept: (last: StatementAnswer) => boolean,
): Promise<StatementAnswer> {
  const connection = await connections.connect();
  try {
    await connection.query('BEGIN');
    const last = await lastAnswerOf(statements, (asked) => connection.query(textOnPostgreSQL(asked), asked.values));
    await connection.query(isKept(last) ? 'COMMIT' : 'ROLLBACK');
    return last;
  } catch (failure) {
    await connection.query('ROLLBACK');
    throw failure;
  } finally {
    connection.release();
  }
}

async function migratedOn(connections: Connections, tables: readonly Statement[]): Promise<void> {
  await inTransaction(
    connections,
    [
      statement`SELECT pg_advisory_xact_lock(${migrationLock})`,
      ...hostTables,
      ...tables,
      ...addedColumns.map(({ addedWhenMissing }) => addedWhenMissing),
      ...indexesOfAddedColumns,
    ],
    alwaysKept,
  );
}

export async function postgresqlDatabaseOn(
  store: EventStore,
  connections: Connections,
  tables: readonly Statement[],
): Promise<HostDatabase> {
  const query = (asked: Statement) =>
    Effect.tryPromise({
      try: () => connections.query(textOnPostgreSQL(asked), asked.values),
      catch: failedWith,
    }).pipe(Effect.map(({ rows }) => rows));
  const transaction = (statements: readonly Statement[]) =>
    Effect.tryPromise({
      try: () => inTransaction(connections, statements, wroteARow),
      catch: failedWith,
    }).pipe(Effect.map(({ rows }) => rows));
  const sharedClock = oneRowOf(NowRow, query(statement`SELECT (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS now`)).pipe(
    Effect.map(({ now }) => now),
  );
  const close = async (): Promise<void> => {
    await store.close();
    await connections.end();
  };
  try {
    await store.migrate();
    await migratedOn(connections, tables);
    return { store, read: query, write: query, transaction, sharedClock, close };
  } catch (failure) {
    await close().catch(Function.constVoid);
    throw failure;
  }
}

export function openPostgreSQLDatabase({
  connectionString,
  reportLostConnection,
  tables,
}: PostgreSQLDatabaseOptions): Promise<HostDatabase> {
  const pool = new Pool({ connectionString, max: connectionsForTheHostTables });
  pool.on('error', reportLostConnection);
  return postgresqlDatabaseOn(postgresqlEventStore({ connectionString, reportLostConnection }), pool, tables);
}
