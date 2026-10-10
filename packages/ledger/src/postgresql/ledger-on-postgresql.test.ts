import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, onTestFinished } from 'vitest';

import type { RecordedStore } from '../event-store.ts';
import { definitionStreamsPlan } from '../postgresql-reads/index-checks.ts';
import { postgresqlRecordedStore } from '../postgresql-reads/postgresql-recorded.ts';
import { ledgerBehaviour } from '../testing/ledger-behaviour.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
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

async function definitionStreamsIndexed(database: string): Promise<boolean> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const { explained, values, throughTheIndex } = definitionStreamsPlan;
    const plan = await client.query<Readonly<Record<string, unknown>>>(explained, values);
    return plan.rows.some((row) => String(row['QUERY PLAN']).includes(throughTheIndex));
  } finally {
    await client.end();
  }
}

async function planOf(database: string, read: (store: RecordedStore) => Promise<unknown>): Promise<string> {
  const asked: { readonly text: string; readonly values: readonly unknown[] }[] = [];
  await read(
    postgresqlRecordedStore((text, values) => {
      asked.push({ text, values });
      return Promise.resolve([]);
    }),
  );
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const plans = await Promise.all(
      asked.map(({ text, values }) => client.query<Readonly<Record<string, unknown>>>(`EXPLAIN ${text}`, [...values])),
    );
    const lines: string[] = [];
    for (const { rows } of plans) {
      lines.push(...rows.map((row) => String(row['QUERY PLAN'])));
    }
    return lines.join('\n');
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

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const longestWaitBehindTheHorizon = 10_000;

function olderThanEveryWriteOpenOnTheServer(besides: string): string {
  return `transaction_id < (
    SELECT coalesce(min(running.xid), pg_snapshot_xmax(pg_current_snapshot()))
    FROM pg_snapshot_xip(pg_current_snapshot()) AS running(xid)
    WHERE running.xid::text <> '${besides}'
  )`;
}

async function untilReadable(
  database: string,
  besides = '',
  deadline = Date.now() + longestWaitBehindTheHorizon,
): Promise<void> {
  const hidden = await queried(
    database,
    `SELECT 1 FROM emt_messages WHERE NOT (${olderThanEveryWriteOpenOnTheServer(besides)}) LIMIT 1`,
  );
  if (hidden.length === 0) {
    return;
  }
  if (Date.now() > deadline) {
    throw new Error(
      `A committed message stayed behind the oldest open transaction of the server for ${longestWaitBehindTheHorizon} ms`,
    );
  }
  await pause(20);
  await untilReadable(database, besides, deadline);
}

const lostConnections: Readonly<Error>[] = [];

const onPostgreSQL: LedgerEntry = {
  mostEventsInOneAppend: 64,
  afterClosing: 'Cannot use a pool after calling end on the pool',
  closedWhileWriting: 'Cannot use a pool after calling end on the pool',
  aDatabase,
  untilReadable,
  ledgerOn: (connectionString, runOutcomes, projections = []) =>
    postgresqlLedgerLayer({ connectionString, projections, ...(runOutcomes === undefined ? {} : { runOutcomes }) }),
  storeOn: (connectionString) =>
    postgresqlEventStore({
      connectionString,
      reportLostConnection: (error) => {
        lostConnections.push(error);
      },
    }),
  queried,
  definitionStreamsIndexed,
  planOf,
  throughTheKindIndex: `Index Cond: (("substring"(stream_id, '^(?:[^/]*/){4}'::text) = ANY`,
  throughTheIdIndex: 'Index Cond: (message_id = ',
  outcomeTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^run_outcomes_[0-9]+$' ORDER BY relname",
  projectionTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^run_tallies_[0-9]+$' ORDER BY relname",
  projectionIndexes:
    "SELECT indexname AS name FROM pg_indexes WHERE indexname ~ '^run_tallies_[0-9]+_' AND indexname !~ '_pkey$' ORDER BY indexname",
  topicTables:
    "SELECT relname AS name FROM pg_class WHERE relkind IN ('r', 'p') AND relname ~ '^topics_[0-9]+$' ORDER BY relname",
};

const skipped = server === '';

const notice = skipped ? ', skipped: set LEDGER_TEST_POSTGRESQL_URL to the URL of a PostgreSQL server to run it' : '';

describe.skipIf(skipped)(`The ledger on PostgreSQL${notice}`, { timeout: 30_000 }, () => {
  ledgerBehaviour(onPostgreSQL);
});
