import { once } from 'node:events';
import { createServer } from 'node:net';

import type { EventStore, StoredRecord } from '@beonauto/ledger';
import { Effect, Function, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DatabaseFailed, HostDatabase, StatementAnswer } from './host-database.ts';
import { openHostDatabase } from './host-databases.ts';
import { addedColumns, hostTables, indexesOfAddedColumns } from './host-tables.ts';
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

function telling(failingOn = '', rowsOf = (text: string): readonly unknown[] => [{ answered: text }]): Telling {
  const asked: Asked[] = [];
  const said: string[] = [];
  const saying = (line: string): Promise<void> => {
    said.push(line);
    return Promise.resolve();
  };
  const answerOf = (text: string): StatementAnswer => {
    const rows = rowsOf(text);
    return { rows, rowCount: rows.length };
  };
  const connection: Connection = {
    query: (text, values = []) => {
      asked.push({ text, values });
      return text === failingOn ? Promise.reject(new Error(`${text} failed`)) : Promise.resolve(answerOf(text));
    },
    release: () => {
      said.push('connection released');
    },
  };
  return {
    store: {
      mostEventsInOneAppend: 64,
      pointLength: 2,
      read: () => Promise.resolve({ version: 0, messages: [] }),
      append: () => Promise.resolve(),
      readRecorded: () => Promise.resolve({ records: [] }),
      readRecordedEvent: (_, id) => Promise.resolve(new Map<string, StoredRecord>().get(id)),
      readAppended: () => Promise.resolve({ streams: [], through: ['0', '0'], more: false }),
      definitionStreams: () => Promise.resolve([]),
      migrate: () => saying('store migrated'),
      close: () => saying('store closed'),
    },
    connections: {
      query: (text, values) => {
        asked.push({ text, values });
        return Promise.resolve(answerOf(text));
      },
      connect: () => Promise.resolve(connection),
      end: () => saying('connections ended'),
    },
    asked: () => asked,
    said: () => said,
  };
}

function clockOf(database: HostDatabase): Effect.Effect<number, DatabaseFailed> {
  return database.sharedClock ?? Effect.die(new Error('The database has no clock of its own'));
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

const tableOfAFolder = statement`CREATE TABLE IF NOT EXISTS folder_rows (playbook_key TEXT NOT NULL PRIMARY KEY)`;

const migrationAsked: readonly Asked[] = [
  { text: 'BEGIN', values: [] },
  { text: 'SELECT pg_advisory_xact_lock($1)', values: [7_461_239_041] },
  ...hostTables.map((table) => ({ text: textOnPostgreSQL(table), values: [] })),
  { text: textOnPostgreSQL(tableOfAFolder), values: [] },
  ...addedColumns.map(({ addedWhenMissing }) => ({ text: textOnPostgreSQL(addedWhenMissing), values: [] })),
  ...indexesOfAddedColumns.map((index) => ({ text: textOnPostgreSQL(index), values: [] })),
  { text: 'COMMIT', values: [] },
];

const thirdTable = textOnPostgreSQL(hostTables[2] ?? statement``);

describe('the host database on PostgreSQL, opening', () => {
  it('migrates the event store, then its own tables and those of its folders in one transaction under a lock of the host', async () => {
    const { store, connections, asked, said } = telling();

    await postgresqlDatabaseOn(store, connections, [tableOfAFolder]);

    expect(asked()).toEqual(migrationAsked);
    expect(said()).toEqual(['store migrated', 'connection released']);
  });

  it('rolls its migration back, and closes, when a table cannot be made', async () => {
    const { store, connections, asked, said } = telling(thirdTable);

    await expect(postgresqlDatabaseOn(store, connections, [])).rejects.toThrow(`${thirdTable} failed`);
    expect(asked().slice(-2)).toEqual([
      { text: thirdTable, values: [] },
      { text: 'ROLLBACK', values: [] },
    ]);
    expect(said()).toEqual(['store migrated', 'connection released', 'store closed', 'connections ended']);
  });

  it('does not open on a server that cannot be reached', async () => {
    const port = await aPortNobodyListensOn();
    const connectionString = `postgresql://playbooks:a-secret@127.0.0.1:${port}/playbooks`;

    await expect(openHostDatabase({ store: 'postgresql', connectionString }, Function.constVoid)).rejects.toThrow(
      `ECONNREFUSED 127.0.0.1:${port}`,
    );
  });
});

describe('the host database on PostgreSQL, open', () => {
  it('reads and writes with its values numbered, and closes the store and its connections', async () => {
    const { store, connections, asked, said } = telling();
    const database = await postgresqlDatabaseOn(store, connections, []);
    const migration = asked().length;

    const read = await Effect.runPromise(database.read(statement`SELECT ${1} AS one`));
    const written = await Effect.runPromise(database.write(statement`DELETE FROM workflow_due WHERE run_key = ${'a'}`));
    await database.close();

    expect(asked().slice(migration)).toEqual([
      { text: 'SELECT $1 AS one', values: [1] },
      { text: 'DELETE FROM workflow_due WHERE run_key = $1', values: ['a'] },
    ]);
    expect([read, written]).toEqual([
      [{ answered: 'SELECT $1 AS one' }],
      [{ answered: 'DELETE FROM workflow_due WHERE run_key = $1' }],
    ]);
    expect(said().slice(-2)).toEqual(['store closed', 'connections ended']);
  });
});

const runsMoved = statement`UPDATE workflow_runs SET status = ${'ended'} WHERE run_key = ${'a'}`;

const checkpointMoved = statement`UPDATE folder_rows SET checkpoint = ${'2'} WHERE playbook_key = ${'a'} AND checkpoint = ${'1'}
  RETURNING playbook_key`;

const transactionAsked: readonly Asked[] = [
  { text: 'BEGIN', values: [] },
  { text: textOnPostgreSQL(runsMoved), values: ['ended', 'a'] },
  { text: textOnPostgreSQL(checkpointMoved), values: ['2', 'a', '1'] },
];

function answeringNothingTo(text: string): (asked: string) => readonly unknown[] {
  return (asked) => (asked === text ? [] : [{ answered: asked }]);
}

describe('the host database on PostgreSQL, writing in one transaction', () => {
  it('runs the statements in order on one connection and keeps them, answering what the last answers, when the last writes a row', async () => {
    const { store, connections, asked, said } = telling();
    const database = await postgresqlDatabaseOn(store, connections, []);
    const migration = asked().length;

    const written = await Effect.runPromise(database.transaction([runsMoved, checkpointMoved]));

    expect(asked().slice(migration)).toEqual([...transactionAsked, { text: 'COMMIT', values: [] }]);
    expect([written, said().at(-1)]).toEqual([
      [{ answered: textOnPostgreSQL(checkpointMoved) }],
      'connection released',
    ]);
  });

  it('keeps none of them when the last writes no row, as when another wrote the row first', async () => {
    const { store, connections, asked } = telling('', answeringNothingTo(textOnPostgreSQL(checkpointMoved)));
    const database = await postgresqlDatabaseOn(store, connections, []);
    const migration = asked().length;

    const written = await Effect.runPromise(database.transaction([runsMoved, checkpointMoved]));

    expect(asked().slice(migration)).toEqual([...transactionAsked, { text: 'ROLLBACK', values: [] }]);
    expect(written).toEqual([]);
  });

  it('keeps none of them, and fails with the error of the driver, when one fails midway', async () => {
    const { store, connections, asked, said } = telling(textOnPostgreSQL(checkpointMoved));
    const database = await postgresqlDatabaseOn(store, connections, []);
    const migration = asked().length;

    const failure = await Effect.runPromise(Effect.flip(database.transaction([runsMoved, checkpointMoved])));

    expect(asked().slice(migration)).toEqual([...transactionAsked, { text: 'ROLLBACK', values: [] }]);
    expect([failure.detail, said().at(-1)]).toEqual([
      `Error: ${textOnPostgreSQL(checkpointMoved)} failed`,
      'connection released',
    ]);
  });
});

describe('the host database on PostgreSQL, telling the time', () => {
  it('reads the clock of the database, which every server on it shares, in milliseconds', async () => {
    const { store, connections, asked } = telling('', () => [{ now: '1790845200000' }]);
    const database = await postgresqlDatabaseOn(store, connections, []);
    const migration = asked().length;

    const now = await Effect.runPromise(clockOf(database));

    expect(now).toBe(1_790_845_200_000);
    expect(asked().slice(migration)).toEqual([
      { text: 'SELECT (EXTRACT(EPOCH FROM now()) * 1000)::bigint AS now', values: [] },
    ]);
  });
});
