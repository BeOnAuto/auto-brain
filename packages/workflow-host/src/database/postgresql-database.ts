import type { EventStore } from '@beonauto/ledger';
import { postgresqlEventStore } from '@beonauto/ledger/postgresql';
import { Effect, Function, Schema } from 'effect';
import { Pool } from 'pg';

import { failedWith, oneRowOf, WholeNumber, type HostDatabase } from './host-database.ts';
import { addedColumns, hostTables, indexesOfAddedColumns } from './host-tables.ts';
import { statement, textOnPostgreSQL, type Statement, type StatementValue } from './statement.ts';

export interface PostgreSQLDatabaseOptions {
  readonly connectionString: string;
  readonly reportLostConnection: (error: Readonly<Error>) => void;
}

interface Answer {
  readonly rows: readonly unknown[];
}

export interface Connection {
  query(text: string, values?: readonly StatementValue[]): Promise<Answer>;
  release(): void;
}

export interface Connections {
  query(text: string, values: readonly StatementValue[]): Promise<Answer>;
  connect(): Promise<Connection>;
  end(): Promise<void>;
}

const connectionsForTheHostTables = 4;

const migrationLock = 7_461_239_041;

const NowRow = Schema.Struct({ now: WholeNumber });

async function createdEach(connection: Connection, tables: readonly Statement[]): Promise<void> {
  const [first, ...rest] = tables;
  if (first !== undefined) {
    await connection.query(textOnPostgreSQL(first));
    await createdEach(connection, rest);
  }
}

async function migratedOn(connections: Connections): Promise<void> {
  const connection = await connections.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock($1)', [migrationLock]);
    await createdEach(connection, [
      ...hostTables,
      ...addedColumns.map(({ addedWhenMissing }) => addedWhenMissing),
      ...indexesOfAddedColumns,
    ]);
    await connection.query('COMMIT');
  } catch (failure) {
    await connection.query('ROLLBACK');
    throw failure;
  } finally {
    connection.release();
  }
}

export async function postgresqlDatabaseOn(store: EventStore, connections: Connections): Promise<HostDatabase> {
  const query = (asked: Statement) =>
    Effect.tryPromise({
      try: () => connections.query(textOnPostgreSQL(asked), asked.values),
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
    await migratedOn(connections);
    return { store, read: query, write: query, sharedClock, close };
  } catch (failure) {
    await close().catch(Function.constVoid);
    throw failure;
  }
}

export function openPostgreSQLDatabase({
  connectionString,
  reportLostConnection,
}: PostgreSQLDatabaseOptions): Promise<HostDatabase> {
  const pool = new Pool({ connectionString, max: connectionsForTheHostTables });
  pool.on('error', reportLostConnection);
  return postgresqlDatabaseOn(postgresqlEventStore({ connectionString, reportLostConnection }), pool);
}
