import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { details, happenings } from '../testing/happenings.ts';
import { ledgerBehaviour } from '../testing/ledger-behaviour.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openLedgerWith, type OpenLedger } from '../testing/open-ledger.ts';
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

describe.skipIf(skipped)(`The ledger on PostgreSQL${notice}`, { timeout: 30_000 }, () => {
  ledgerBehaviour(onPostgreSQL);
});

type RecordedSelection = Parameters<OpenLedger['ledger']['readRecorded']>[1];

const alpha = { org: 'acme', brain: 'alpha' };

async function anAppendLeftOpen(database: string, stream: string, type: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY['{}'::jsonb], ARRAY['1'], ARRAY[$2], ARRAY['E'], $3, 'brain', 0, 'emt:default')`,
    [{ json: JSON.stringify({ type, detail: 'late' }) }, type, stream],
  );
  return client;
}

interface OpenWrite {
  readonly client: Client;
  readonly id: string;
}

async function aWriteLeftOpenElsewhere(): Promise<OpenWrite> {
  const client = new Client({ connectionString: server });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  const { rows } = await client.query<{ readonly id: string }>('SELECT pg_current_xact_id()::text AS id');
  return { client, id: rows[0]?.id ?? '' };
}

function reading(ledger: OpenLedger['ledger'], selection: RecordedSelection, order: 'asc' | 'desc', cursor?: string) {
  return Effect.runPromise(
    ledger.readRecorded(alpha, selection, { order, limit: 10, ...(cursor === undefined ? {} : { cursor }) }),
  );
}

function noting(ledger: OpenLedger['ledger'], stream: string, type: string, detail: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(`brain/acme/alpha/${stream}`, happenings, [{ type, detail }]));
}

async function aLedgerOnItsOwnDatabase(): Promise<{
  readonly database: string;
  readonly ledger: OpenLedger['ledger'];
}> {
  const database = await aDatabase();
  const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
  onTestFinished(dispose);
  return { database, ledger };
}

const everything: RecordedSelection = { kind: 'everything' };

const runs: RecordedSelection = { kind: 'executions' };

describe.skipIf(skipped)(`A read on PostgreSQL while an append is still open${notice}`, { timeout: 30_000 }, () => {
  it('oldest first, stays behind it, and delivers every message once after it commits', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'notes', 'noted', 'before');
    await untilReadable(database);
    const open = await anAppendLeftOpen(database, 'brain/acme/alpha/late', 'noted');
    await noting(ledger, 'notes', 'noted', 'after');

    const whileOpen = await reading(ledger, everything, 'asc');
    await open.query('COMMIT');
    await untilReadable(database);
    const rest = await reading(ledger, everything, 'asc', String(whileOpen.records.at(-1)?.id));

    expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
  });

  it('newest first, reads every message committed, the one committed after it included', async () => {
    const { database, ledger } = await aLedgerOnItsOwnDatabase();
    await noting(ledger, 'notes', 'noted', 'before');
    const open = await anAppendLeftOpen(database, 'brain/acme/alpha/late', 'noted');
    await noting(ledger, 'notes', 'noted', 'after');

    const whileOpen = await reading(ledger, everything, 'desc');
    await open.query('COMMIT');
    const afterCommit = await reading(ledger, everything, 'desc');

    expect([details(whileOpen), details(afterCommit)]).toEqual([
      ['after', 'before'],
      ['after', 'late', 'before'],
    ]);
  });
});

describe.skipIf(skipped)(
  `A list of runs on PostgreSQL while an append is still open${notice}`,
  { timeout: 30_000 },
  () => {
    it('lists runs oldest first behind it, and every run once after it commits', async () => {
      const { database, ledger } = await aLedgerOnItsOwnDatabase();
      await noting(ledger, 'executions/r-before', 'execution_started', 'before');
      await untilReadable(database);
      const open = await anAppendLeftOpen(database, 'brain/acme/alpha/executions/r-late', 'execution_started');
      await noting(ledger, 'executions/r-after', 'execution_started', 'after');

      const whileOpen = await reading(ledger, runs, 'asc');
      await open.query('COMMIT');
      await untilReadable(database);
      const rest = await reading(ledger, runs, 'asc', String(whileOpen.records.at(-1)?.id));

      expect([details(whileOpen), details(rest)]).toEqual([['before'], ['late', 'after']]);
    });

    it('lets a write open in another database of the server hide nothing', async () => {
      const { database, ledger } = await aLedgerOnItsOwnDatabase();
      await noting(ledger, 'notes', 'noted', 'before');
      const elsewhere = await aWriteLeftOpenElsewhere();
      await noting(ledger, 'notes', 'noted', 'after');
      await untilReadable(database, elsewhere.id);

      const whileOpen = await reading(ledger, everything, 'asc');
      await elsewhere.client.query('COMMIT');

      expect(details(whileOpen)).toEqual(['before', 'after']);
    });
  },
);

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
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'emt_messages' AND indexname LIKE 'ledger%' ORDER BY indexname",
      ),
    ).toEqual([
      {
        indexname: 'ledger_first_messages_by_kind',
        indexdef: `CREATE INDEX ledger_first_messages_by_kind ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){4}'::text), stream_position, transaction_id, global_position)`,
      },
      {
        indexname: 'ledger_messages_by_brain',
        indexdef: `CREATE INDEX ledger_messages_by_brain ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), transaction_id, global_position)`,
      },
      {
        indexname: 'ledger_messages_by_brain_and_time',
        indexdef: `CREATE INDEX ledger_messages_by_brain_and_time ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), created, transaction_id, global_position)`,
      },
      {
        indexname: 'ledger_messages_by_stream',
        indexdef:
          'CREATE INDEX ledger_messages_by_stream ON ONLY public.emt_messages USING btree (stream_id, transaction_id, global_position)',
      },
    ]);
  });

  it('are found, not created again, by a start that an append left open does not hold up', async () => {
    const { database } = await aLedgerOnItsOwnDatabase();
    const open = await anAppendLeftOpen(database, 'brain/acme/alpha/late', 'noted');

    const started = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    await started.dispose();
    await open.query('COMMIT');

    expect(
      await queried(database, "SELECT count(*)::int AS indexes FROM pg_indexes WHERE indexname LIKE 'ledger%'"),
    ).toEqual([{ indexes: 4 }]);
  });
});
