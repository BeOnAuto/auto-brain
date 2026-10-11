import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { Effect, Layer, Logger } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { openLedgerWith } from '../testing/open-ledger.ts';
import { tally } from '../testing/tally.ts';
import { postgresqlLedgerLayer } from './postgresql-ledger.ts';
import { emmettsMigrationLock } from './postgresql-run-outcomes.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

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

const closedWithinMs = 5000;

const heldPastTheMigratorsOwnWaitMs = 12_000;

async function untilNoneOpen(database: string): Promise<void> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await vi.waitFor(
      async () => {
        const { rows } = await client.query<Readonly<Record<string, unknown>>>(connectionsTo(database));
        expect({ afterDisposal: rows }).toEqual({ afterDisposal: [{ open: 0 }] });
      },
      { timeout: closedWithinMs, interval: 50 },
    );
  } finally {
    await client.end();
  }
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

  it('closes every connection to the database when the runtime is disposed', { timeout: 30_000 }, async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await Effect.runPromise(ledger.load('org/acme/tallies', tally));
    const whileOpen = await queried(database, connectionsTo(database));

    await dispose();

    expect(whileOpen).toEqual([{ open: 1 }]);
    await untilNoneOpen(database);
  });
});

describe.skipIf(skipped)(
  `A ledger whose PostgreSQL database another server is filling${notice}`,
  { timeout: 30_000 },
  () => {
    it('waits past the 10 s the migrator itself waits for the migration lock, and builds once the fill is done', async () => {
      const database = await aDatabase();
      const filling = new Client({ connectionString: database });
      await filling.connect();
      onTestFinished(() => filling.end());
      await filling.query('SELECT pg_advisory_lock($1)', [emmettsMigrationLock]);
      const fill = { done: false };

      const opening = openLedgerWith(postgresqlLedgerLayer({ connectionString: database })).then((opened) => ({
        opened,
        afterTheFill: fill.done,
      }));
      await setTimeout(heldPastTheMigratorsOwnWaitMs);
      fill.done = true;
      await filling.query('SELECT pg_advisory_unlock($1)', [emmettsMigrationLock]);
      const { opened, afterTheFill } = await opening;
      onTestFinished(opened.dispose);

      expect(afterTheFill).toBe(true);
      expect(await Effect.runPromise(opened.ledger.execute('org/acme/tallies', tally, [1]))).toEqual({
        state: 1,
        version: 1,
      });
    });
  },
);

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

  it("keeps each event's data as its JSON text and its context as plain jsonb in Emmett's messages table", async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]));
    await dispose();

    expect(
      await queried(
        database,
        "SELECT stream_id, stream_position::int, message_type, message_data, message_metadata ->> 'by' AS by FROM emt_messages",
      ),
    ).toEqual([
      {
        stream_id: 'org/acme/tallies',
        stream_position: 1,
        message_type: 'counted',
        message_data: { json: '{"by":2}' },
        by: 'tester',
      },
    ]);
  });
});
