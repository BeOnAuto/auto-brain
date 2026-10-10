import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { theBrainIndexes } from '../postgresql-reads/index-checks.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlLedgerLayer } from './postgresql-ledger.ts';

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

async function aLedgerOnItsOwnDatabase(): Promise<string> {
  const database = await aDatabase();
  const { dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
  onTestFinished(dispose);
  return database;
}

async function anAppendLeftOpen(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY[$3::jsonb], ARRAY['1'], ARRAY['noted'], ARRAY['E'], $2, 'brain', 0, 'emt:default')`,
    [
      { json: JSON.stringify({ detail: 'late' }) },
      'brain/acme/alpha/late',
      { at: '2026-10-05T09:00:00.000Z', by: 'tester' },
    ],
  );
  return client;
}

describe.skipIf(skipped)(`The brain's indexes on PostgreSQL${notice}`, { timeout: 30_000 }, () => {
  it('are created when the ledger opens, once however often it opens', async () => {
    const database = await aDatabase();
    const first = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await first.dispose();
    const second = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await second.dispose();

    expect(
      await queried(
        database,
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('emt_messages', 'emt_streams') AND indexname LIKE 'ledger%' ORDER BY indexname",
      ),
    ).toEqual(theBrainIndexes);
  });

  it('are found, not created again, by a start that an append left open does not hold up', async () => {
    const database = await aLedgerOnItsOwnDatabase();
    const open = await anAppendLeftOpen(database);

    const started = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await started.dispose();
    await open.query('COMMIT');

    expect(
      await queried(database, "SELECT count(*)::int AS indexes FROM pg_indexes WHERE indexname LIKE 'ledger%'"),
    ).toEqual([{ indexes: 7 }]);
  });
});
