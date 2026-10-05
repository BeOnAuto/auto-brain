import { randomUUID } from 'node:crypto';

import { Effect, Layer, Logger } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { ledgerBehaviour } from '../testing/ledger-behaviour.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { postgresqlEventStore, postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

async function queried(database: string, statement: string): Promise<readonly unknown[]> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(statement);
    return rows;
  } finally {
    await client.end();
  }
}

async function aDatabase(): Promise<string> {
  const name = `ledger_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

const lostConnections: Readonly<Error>[] = [];

const onPostgreSQL: LedgerEntry = {
  mostEventsInOneAppend: 64,
  afterClosing: 'Cannot use a pool after calling end on the pool',
  closedWhileWriting: 'Cannot use a pool after calling end on the pool',
  aDatabase,
  ledgerOn: (connectionString) => postgresqlLedgerLayer({ connectionString }),
  storeOn: (connectionString) =>
    postgresqlEventStore({
      connectionString,
      reportLostConnection: (error) => {
        lostConnections.push(error);
      },
    }),
};

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

describe.skipIf(skipped)(`The ledger on PostgreSQL${notice}`, () => {
  ledgerBehaviour(onPostgreSQL);
});

const lostConnection =
  '"message":"A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one","level":"WARN"';

function otherConnectionsTo(database: string): string {
  return `FROM pg_stat_activity WHERE datname = '${new URL(database).pathname.slice(1)}' AND pid <> pg_backend_pid()`;
}

function connectionsTo(database: string): string {
  return `SELECT count(*)::int AS open ${otherConnectionsTo(database)}`;
}

function endingConnectionsTo(database: string): string {
  return `SELECT pg_terminate_backend(pid) AS ended ${otherConnectionsTo(database)}`;
}

describe.skipIf(skipped)(`A ledger on a PostgreSQL database of its own${notice}`, () => {
  it('builds on a database that another server is migrating at the same moment', async () => {
    const database = await aDatabase();

    const [first, second] = await Promise.all([
      openLedgerWith(postgresqlLedgerLayer({ connectionString: database })),
      openLedgerWith(postgresqlLedgerLayer({ connectionString: database })),
    ]);
    await Effect.runPromise(first.ledger.execute('org/acme/tallies', tally, [1]));
    const loaded = await Effect.runPromise(second.ledger.load('org/acme/tallies', tally));
    await Promise.all([first.dispose(), second.dispose()]);

    expect(loaded).toEqual({ state: 1, version: 1 });
  });

  it('closes every connection to the database when the runtime is disposed', async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await Effect.runPromise(ledger.load('org/acme/tallies', tally));
    const whileOpen = await queried(database, connectionsTo(database));

    await dispose();

    expect({ whileOpen, afterDisposal: await queried(database, connectionsTo(database)) }).toEqual({
      whileOpen: [{ open: 1 }],
      afterDisposal: [{ open: 0 }],
    });
  });
});

describe.skipIf(skipped)(`A ledger whose PostgreSQL database ends its connections${notice}`, () => {
  it('reports each lost connection to the log, and goes on reading and appending on new ones', async () => {
    const database = await aDatabase();
    const logged: string[] = [];
    const capture = Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
    });
    const { ledger, dispose } = await openLedgerWith(
      postgresqlLedgerLayer({ connectionString: database }).pipe(Layer.provide(Logger.layer([capture]))),
    );
    onTestFinished(dispose);
    await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [1]));

    const ended = await queried(database, endingConnectionsTo(database));
    await vi.waitFor(() => {
      expect(logged).toHaveLength(ended.length);
    });

    expect(await Effect.runPromise(ledger.load('org/acme/tallies', tally))).toEqual({ state: 1, version: 1 });
    expect(await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]))).toEqual({ state: 3, version: 2 });
    expect(ended.length).toBeGreaterThan(0);
    expect(logged.filter((line) => !line.includes(lostConnection))).toEqual([]);
  });

  it("keeps each event as its JSON text in Emmett's messages table", async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]));
    await dispose();

    expect(
      await queried(database, 'SELECT stream_id, stream_position::int, message_type, message_data FROM emt_messages'),
    ).toEqual([
      {
        stream_id: 'org/acme/tallies',
        stream_position: 1,
        message_type: 'counted',
        message_data: { json: '{"type":"counted","by":2}' },
      },
    ]);
  });
});
