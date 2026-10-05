import { once } from 'node:events';
import { createServer } from 'node:net';

import type { EventStore } from '@beonauto/ledger';
import { Effect, Function, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openHostDatabase } from './host-databases.ts';
import { hostTables } from './host-tables.ts';
import { postgresqlDatabaseOn, type Connection, type Connections } from './postgresql-database.ts';
import { statement, textOnPostgreSQL, type StatementValue } from './statement.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly StatementValue[];
}

interface Telling {
  readonly store: EventStore;
  readonly connections: Connections;
  readonly asked: () => readonly Asked[];
  readonly said: () => readonly string[];
}

function telling(failingOn = ''): Telling {
  const asked: Asked[] = [];
  const said: string[] = [];
  const saying = (line: string): Promise<void> => {
    said.push(line);
    return Promise.resolve();
  };
  const connection: Connection = {
    query: (text, values = []) => {
      asked.push({ text, values });
      return text === failingOn ? Promise.reject(new Error(`${text} failed`)) : Promise.resolve({ rows: [] });
    },
    release: () => {
      said.push('connection released');
    },
  };
  return {
    store: {
      mostEventsInOneAppend: 64,
      pointLength: 2,
      read: () => Promise.resolve({ version: 0, events: [] }),
      append: () => Promise.resolve(),
      readRecorded: () => Promise.resolve({ records: [] }),
      migrate: () => saying('store migrated'),
      close: () => saying('store closed'),
    },
    connections: {
      query: (text, values) => {
        asked.push({ text, values });
        return Promise.resolve({ rows: [{ answered: text }] });
      },
      connect: () => Promise.resolve(connection),
      end: () => saying('connections ended'),
    },
    asked: () => asked,
    said: () => said,
  };
}

const decodePort = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function aPortNobodyListensOn(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = decodePort(server.address());
  server.close();
  await once(server, 'close');
  return port;
}

const migrationAsked: readonly Asked[] = [
  { text: 'BEGIN', values: [] },
  { text: 'SELECT pg_advisory_xact_lock($1)', values: [7_461_239_041] },
  ...hostTables.map((table) => ({ text: textOnPostgreSQL(table), values: [] })),
  { text: 'COMMIT', values: [] },
];

const thirdTable = textOnPostgreSQL(hostTables[2] ?? statement``);

describe('the host database on PostgreSQL, opening', () => {
  it('migrates the event store, then its own tables in one transaction under a lock of the host', async () => {
    const { store, connections, asked, said } = telling();

    await postgresqlDatabaseOn(store, connections);

    expect(asked()).toEqual(migrationAsked);
    expect(said()).toEqual(['store migrated', 'connection released']);
  });

  it('rolls its migration back, and closes, when a table cannot be made', async () => {
    const { store, connections, asked, said } = telling(thirdTable);

    await expect(postgresqlDatabaseOn(store, connections)).rejects.toThrow(`${thirdTable} failed`);
    expect(asked().slice(-2)).toEqual([
      { text: thirdTable, values: [] },
      { text: 'ROLLBACK', values: [] },
    ]);
    expect(said()).toEqual(['store migrated', 'connection released', 'store closed', 'connections ended']);
  });

  it('does not open on a server that cannot be reached', async () => {
    const port = await aPortNobodyListensOn();
    const connectionString = `postgresql://brains:a-secret@127.0.0.1:${port}/brains`;

    await expect(openHostDatabase({ store: 'postgresql', connectionString }, Function.constVoid)).rejects.toThrow(
      `ECONNREFUSED 127.0.0.1:${port}`,
    );
  });
});

describe('the host database on PostgreSQL, open', () => {
  it('reads and writes with its values numbered, and closes the store and its connections', async () => {
    const { store, connections, asked, said } = telling();
    const database = await postgresqlDatabaseOn(store, connections);
    const migration = asked().length;

    const read = await Effect.runPromise(database.read(statement`SELECT ${1} AS one`));
    const written = await Effect.runPromise(database.write(statement`DELETE FROM workflow_due WHERE run_id = ${'a'}`));
    await database.close();

    expect(asked().slice(migration)).toEqual([
      { text: 'SELECT $1 AS one', values: [1] },
      { text: 'DELETE FROM workflow_due WHERE run_id = $1', values: ['a'] },
    ]);
    expect([read, written]).toEqual([
      [{ answered: 'SELECT $1 AS one' }],
      [{ answered: 'DELETE FROM workflow_due WHERE run_id = $1' }],
    ]);
    expect(said().slice(-2)).toEqual(['store closed', 'connections ended']);
  });
});
