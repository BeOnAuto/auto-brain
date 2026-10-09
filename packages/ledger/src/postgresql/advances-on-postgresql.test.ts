import { randomUUID } from 'node:crypto';

import { topicFacts, topicRows } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlLedgerLayer } from './postgresql-ledger.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

const longestWaitForALock = 10_000;

async function connected(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  onTestFinished(() => client.end());
  return client;
}

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
  const name = `advances_${randomUUID().replaceAll('-', '')}`;
  await queried(server, `CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await queried(server, `DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(server);
  database.pathname = `/${name}`;
  return database.href;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const waitingOnALock =
  "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'";

async function untilAWriteWaitsOnALock(database: string, deadline = Date.now() + longestWaitForALock): Promise<void> {
  const [counted] = await queried(database, waitingOnALock);
  if (JSON.stringify(counted) === JSON.stringify({ waiting: 1 })) {
    return;
  }
  if (Date.now() > deadline) {
    throw new Error(`No write waited on a lock within ${longestWaitForALock} ms`);
  }
  await pause(20);
  await untilAWriteWaitsOnALock(database, deadline);
}

describe.skipIf(skipped)(`A fold beside an advance of the same row on PostgreSQL${notice}`, { timeout: 30_000 }, () => {
  it('leaves the columns the advance wrote, though the fold read the row before the advance committed', async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(
      postgresqlLedgerLayer({ connectionString: database, projections: [topicRows] }),
    );
    onTestFinished(dispose);
    await Effect.runPromise(
      ledger.execute('brain/acme/alpha/executions/r1', topicFacts, [
        { type: 'topic_opened', topic: 'spring', at: 1000 },
      ]),
    );
    const advancing = await connected(database);
    await advancing.query('BEGIN');
    await advancing.query("UPDATE topics_1 SET open = false, next_at = NULL, due_at = NULL WHERE row_key = 'spring'");

    const folding = Effect.runPromise(
      ledger.execute('brain/acme/alpha/notes/n1', topicFacts, [
        { type: 'topic_noted', topic: 'spring', note: 'during' },
      ]),
    );
    await untilAWriteWaitsOnALock(database);
    await advancing.query('COMMIT');
    await folding;

    expect(
      await queried(database, "SELECT note, open, next_at, due_at FROM topics_1 WHERE row_key = 'spring'"),
    ).toEqual([{ note: 'during', open: false, next_at: null, due_at: null }]);
  });
});
