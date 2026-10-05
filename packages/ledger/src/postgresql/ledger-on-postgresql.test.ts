import { randomUUID } from 'node:crypto';

import { Effect, Layer, Logger } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { happenings } from '../testing/happenings.ts';
import { ledgerBehaviour } from '../testing/ledger-behaviour.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openLedgerWith, type OpenLedger } from '../testing/open-ledger.ts';
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

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function untilReadable(database: string): Promise<void> {
  const hidden = await queried(
    database,
    'SELECT 1 FROM emt_messages WHERE transaction_id >= pg_snapshot_xmin(pg_current_snapshot()) LIMIT 1',
  );
  if (hidden.length > 0) {
    await pause(20);
    await untilReadable(database);
  }
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

const alpha = { org: 'acme', brain: 'alpha' };

async function anAppendLeftOpen(database: string): Promise<Client> {
  const client = new Client({ connectionString: database });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query(
    `SELECT success FROM emt_append_to_stream(
      ARRAY['late-1'], ARRAY[$1::jsonb], ARRAY['{}'::jsonb], ARRAY['1'], ARRAY['noted'], ARRAY['E'],
      'brain/acme/alpha/late', 'brain', 0, 'emt:default')`,
    [{ json: JSON.stringify({ type: 'noted', detail: 'late' }) }],
  );
  return client;
}

function readingAlpha(ledger: OpenLedger['ledger'], order: 'asc' | 'desc', cursor?: string) {
  return Effect.runPromise(
    ledger.readRecorded(
      alpha,
      { kind: 'everything' },
      { order, limit: 10, ...(cursor === undefined ? {} : { cursor }) },
    ),
  );
}

function detailsOf({ records }: { readonly records: readonly { readonly data: unknown }[] }): readonly unknown[] {
  return records.map(({ data }) =>
    typeof data === 'object' && data !== null && 'detail' in data ? data.detail : null,
  );
}

describe.skipIf(skipped)(`A read on PostgreSQL while an earlier append is still open${notice}`, () => {
  it('stays behind it, and delivers its messages once it commits, oldest or newest first', async () => {
    const database = await aDatabase();
    const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
    onTestFinished(dispose);
    const note = (detail: string) =>
      Effect.runPromise(ledger.execute('brain/acme/alpha/notes', happenings, [{ type: 'noted', detail }]));
    await note('before');
    await untilReadable(database);
    const open = await anAppendLeftOpen(database);
    await note('after');

    const [oldestWhileOpen, newestWhileOpen] = await Promise.all([
      readingAlpha(ledger, 'asc'),
      readingAlpha(ledger, 'desc'),
    ]);
    await open.query('COMMIT');
    await untilReadable(database);
    const [rest, newestAfterCommit] = await Promise.all([
      readingAlpha(ledger, 'asc', String(oldestWhileOpen.records.at(-1)?.id)),
      readingAlpha(ledger, 'desc'),
    ]);

    expect([oldestWhileOpen, newestWhileOpen, rest, newestAfterCommit].map((page) => detailsOf(page))).toEqual([
      ['before'],
      ['before'],
      ['late', 'after'],
      ['after', 'late', 'before'],
    ]);
  });
});

async function aWriteLeftOpenElsewhere(): Promise<Client> {
  const client = new Client({ connectionString: server });
  await client.connect();
  onTestFinished(() => client.end());
  await client.query('BEGIN');
  await client.query('SELECT pg_current_xact_id()');
  return client;
}

describe.skipIf(skipped)(
  `A read on PostgreSQL while a write is open in another database of the server${notice}`,
  () => {
    it('stays behind it too, since a transaction id belongs to the whole server', async () => {
      const database = await aDatabase();
      const { ledger, dispose } = await openLedgerWith(postgresqlLedgerLayer({ connectionString: database }));
      onTestFinished(dispose);
      await Effect.runPromise(
        ledger.execute('brain/acme/alpha/notes', happenings, [{ type: 'noted', detail: 'before' }]),
      );
      await untilReadable(database);
      const elsewhere = await aWriteLeftOpenElsewhere();
      await Effect.runPromise(
        ledger.execute('brain/acme/alpha/notes', happenings, [{ type: 'noted', detail: 'after' }]),
      );

      const whileOpen = await readingAlpha(ledger, 'asc');
      await elsewhere.query('COMMIT');
      await untilReadable(database);
      const afterCommit = await readingAlpha(ledger, 'asc');

      expect([detailsOf(whileOpen), detailsOf(afterCommit)]).toEqual([['before'], ['before', 'after']]);
    });
  },
);

describe.skipIf(skipped)(`The brain's indexes on PostgreSQL${notice}`, () => {
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
        indexdef: `CREATE INDEX ledger_first_messages_by_kind ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){4}'::text), transaction_id, global_position) WHERE (stream_position = 1)`,
      },
      {
        indexname: 'ledger_messages_by_brain',
        indexdef: `CREATE INDEX ledger_messages_by_brain ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), transaction_id, global_position)`,
      },
      {
        indexname: 'ledger_messages_by_brain_and_time',
        indexdef: `CREATE INDEX ledger_messages_by_brain_and_time ON ONLY public.emt_messages USING btree ("substring"(stream_id, '^(?:[^/]*/){3}'::text), created, transaction_id, global_position)`,
      },
    ]);
  });
});
