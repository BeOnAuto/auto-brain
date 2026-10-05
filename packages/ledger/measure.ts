import { DatabaseSync } from 'node:sqlite';

import type { Ledger } from '@beonauto/operations';
import { Effect, type Layer } from 'effect';
import { Client } from 'pg';

import { executions, longRun, tick, timeOf } from './measure-data.ts';
import { postgresqlLedgerLayer } from './src/postgresql/postgresql-ledger.ts';
import { cursorOf } from './src/recorded/cursor.ts';
import { ledgerLayer } from './src/sqlite3.ts';
import { openLedgerWith, type OpenLedger } from './src/testing/open-ledger.ts';
import { temporaryDatabase } from './src/testing/temporary-database.ts';

type AnyLedger = OpenLedger['ledger'];

type Selection = Parameters<AnyLedger['readRecorded']>[1];

type Page = Parameters<AnyLedger['readRecorded']>[2];

type Point = readonly string[];

type Case = readonly [label: string, selection: Selection, page: Page];

const runs = Number(process.env['LEDGER_MEASURE_RUNS'] ?? 100_000);

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const brain = { org: 'o1', brain: 'big' };

const brainKey = 'brain/o1/big/';

const needed = [
  [`${brainKey}executions/00050000`, 1],
  [`${brainKey}executions/00050015`, 1],
  [longRun, 50_000],
] as const;

const indexes = [
  'ledger_messages_by_brain',
  'ledger_messages_by_brain_and_time',
  'ledger_messages_by_stream',
  'ledger_first_messages_by_kind',
];

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function aPage(order: 'asc' | 'desc', limit: number, more: Omit<Page, 'order' | 'limit'> = {}): Page {
  return { order, limit, ...more };
}

function casesOf(selection: Selection, pages: readonly (readonly [string, Page])[]): readonly Case[] {
  return pages.map(([label, onePage]) => [label, selection, onePage]);
}

function cases(pointOf: (stream: string, at: number) => Point): readonly Case[] {
  const cursor = cursorOf(brainKey, pointOf(executions(50_000), 1));
  const middleOfTheLongRun = cursorOf(brainKey, pointOf(longRun, 50_000));
  const since = timeOf(50_000);
  return [
    ...casesOf({ kind: 'everything' }, [
      ['The brain, first page, newest first', aPage('desc', 20)],
      ['The brain, first page, oldest first', aPage('asc', 20)],
      ['The brain, deep page, newest first', aPage('desc', 20, { cursor })],
      ['The brain, deep page, oldest first', aPage('asc', 20, { cursor })],
      ['The brain, deep page of 100, newest first', aPage('desc', 100, { cursor })],
      [
        'The brain, a page holding a run of 1.25 MiB',
        aPage('desc', 20, { cursor: cursorOf(brainKey, pointOf(executions(50_015), 1)) }),
      ],
      ['The brain, of one rare type, newest first', aPage('desc', 20, { types: ['execution_failed'] })],
      ['The brain since a time, oldest first', aPage('asc', 20, { since })],
      ['The brain since a time, newest first', aPage('desc', 20, { since })],
    ]),
    ...casesOf({ kind: 'run', execution: '00050000' }, [
      ['One run of 21 messages, oldest first', aPage('asc', 20)],
      ['One run of 21 messages, newest first', aPage('desc', 20)],
    ]),
    ...casesOf({ kind: 'run', execution: 'long-running' }, [
      ['A run of 100,001 messages, first page, oldest first', aPage('asc', 20)],
      ['A run of 100,001 messages, first page, newest first', aPage('desc', 20)],
      ['A run of 100,001 messages, from its middle, oldest first', aPage('asc', 20, { cursor: middleOfTheLongRun })],
      ['A run of 100,001 messages, from its middle, newest first', aPage('desc', 20, { cursor: middleOfTheLongRun })],
    ]),
    ...casesOf({ kind: 'executions' }, [
      ['Runs, first page, newest first', aPage('desc', 20)],
      ['Runs, first page, oldest first', aPage('asc', 20)],
      ['Runs, deep page, newest first', aPage('desc', 20, { cursor })],
      ['Runs, deep page, oldest first', aPage('asc', 20, { cursor })],
      ['Runs, deep page of 100, newest first', aPage('desc', 100, { cursor })],
      ['Runs that succeeded, newest first', aPage('desc', 20, { types: ['execution_succeeded'] })],
      ['Runs that succeeded, deep page, oldest first', aPage('asc', 20, { cursor, types: ['execution_succeeded'] })],
      ['Runs that failed, newest first', aPage('desc', 20, { types: ['execution_failed'] })],
      ['Runs that failed, deep page, oldest first', aPage('asc', 20, { cursor, types: ['execution_failed'] })],
      ['Runs of a status none has, 1,000 examined', aPage('desc', 20, { types: ['execution_unknown'] })],
    ]),
  ];
}

const behindOthers = 'behind a million newer messages of other brains';

const quietCases: readonly Case[] = [
  [`The brain, newest first, ${behindOthers}`, { kind: 'everything' }, aPage('desc', 20)],
  [`Runs, newest first, ${behindOthers}`, { kind: 'executions' }, aPage('desc', 20)],
  [
    `A run of 100,001 messages, newest first, ${behindOthers}`,
    { kind: 'run', execution: 'long-running' },
    aPage('desc', 20),
  ],
];

const othersInSQLite = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000000)
  INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata,
    message_schema_version, message_type, message_id)
  SELECT 'brain/o3/other-' || (i % 50) || '/executions/' || i, 1, 'emt:default', '{"type":"execution_started"}', '{}',
    '1', 'execution_started', 'later-' || i FROM n`;

const othersInPostgreSQL = `INSERT INTO emt_messages (stream_id, stream_position, message_data, message_metadata,
    message_schema_version, message_type, message_id, transaction_id)
  SELECT 'brain/o3/other-' || (i % 50) || '/executions/' || i, 1, jsonb_build_object('json', '{"type":"execution_started"}'),
    '{}', '1', 'execution_started', 'later-' || i, pg_current_xact_id()
  FROM generate_series(1, 1000000) AS i`;

async function timed<A>(attempt: () => Promise<A>): Promise<{ readonly took: number; readonly answer: A }> {
  const started = performance.now();
  const answer = await attempt();
  return { took: performance.now() - started, answer };
}

async function measured(ledger: AnyLedger, [label, selection, page]: Case): Promise<string> {
  const read = () => Effect.runPromise(ledger.readRecorded(brain, selection, page));
  await Effect.runPromise(Effect.forEach([1, 2, 3], () => Effect.promise(read), { discard: true }));
  const reads = await Effect.runPromise(
    Effect.forEach(Array.from({ length: 20 }), () => Effect.promise(() => timed(read))),
  );
  const times = reads.map(({ took }) => took).toSorted((left, right) => left - right);
  const { records } = reads[0]?.answer ?? { records: [] };
  const kibibytes = Math.round(JSON.stringify(records).length / 1024);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  return `| ${label} | ${median.toFixed(2)} | ${Math.max(...times).toFixed(2)} | ${records.length} | ${kibibytes} KiB |`;
}

function measuredAll(ledger: AnyLedger, all: readonly Case[]): Promise<readonly string[]> {
  return Effect.runPromise(Effect.forEach(all, (each) => Effect.promise(() => measured(ledger, each))));
}

async function pagesOf(
  layer: Layer.Layer<Ledger>,
  pointOf: (stream: string, at: number) => Point,
  othersWrite: () => Promise<unknown>,
): Promise<void> {
  const building = await timed(() => openLedgerWith(layer));
  write(`The ledger opened and built its indexes in ${Math.round(building.took)} ms.`);
  await building.answer.dispose();
  const { ledger, dispose } = await openLedgerWith(layer);
  write('| Page | median ms | slowest ms | records | data |\n| --- | --- | --- | --- | --- |');
  const lines = await measuredAll(ledger, cases(pointOf));
  await othersWrite();
  write([...lines, ...(await measuredAll(ledger, quietCases))].join('\n'));
  await dispose();
}

async function measureSQLite(): Promise<void> {
  const { fileName, remove } = temporaryDatabase();
  const creating = await openLedgerWith(ledgerLayer({ fileName }));
  await creating.dispose();
  const database = new DatabaseSync(fileName);
  database.exec(indexes.map((index) => `DROP INDEX ${index};`).join(' '));
  const insert = database.prepare(`INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind,
    message_data, message_metadata, message_schema_version, message_type, message_id, is_archived, created)
    VALUES (?, ?, 'emt:default', 'E', ?, '{}', '1', ?, ?, 0, ?)`);
  database.exec('BEGIN');
  for (let t = 0; t < runs; t += 1) {
    const created = timeOf(t).slice(0, 19).replace('T', ' ');
    for (const [index, message] of tick(t).entries()) {
      insert.run(message.stream, message.position, message.data, message.type, `m${t}-${index}`, created);
    }
  }
  database.exec('COMMIT');
  const position = database.prepare(
    'SELECT global_position AS p FROM emt_messages WHERE stream_id = ? AND stream_position = ?',
  );
  const points = new Map(needed.map(([stream, at]) => [`${stream}#${at}`, [String(position.get(stream, at)?.['p'])]]));
  const count = database.prepare('SELECT count(*) AS n FROM emt_messages').get()?.['n'];
  database.close();
  write(`SQLite, ${String(count)} messages:`);
  const othersWrite = () => {
    const others = new DatabaseSync(fileName);
    others.exec(othersInSQLite);
    others.close();
    return Promise.resolve();
  };
  await pagesOf(ledgerLayer({ fileName }), (stream, at) => points.get(`${stream}#${at}`) ?? [], othersWrite);
  remove();
}

async function filledWithPostgreSQL(client: Readonly<Pick<Client, 'query'>>): Promise<void> {
  await client.query(`DROP INDEX ${indexes.join(', ')}`);
  await client.query('SET synchronous_commit = off');
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: runs }, (_, t) => t),
      (t) =>
        Effect.promise(() =>
          client.query(
            `INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind, message_data,
              message_metadata, message_schema_version, message_type, message_id, is_archived, transaction_id, created)
            SELECT r.stream, r.position, 'emt:default', 'E', jsonb_build_object('json', r.data), '{}', '1', r.type,
              'm' || $2 || '-' || r.n, false, pg_current_xact_id(), $3::timestamptz
            FROM ROWS FROM (jsonb_to_recordset($1::jsonb) AS (stream text, position int, type text, data text))
              WITH ORDINALITY AS r(stream, position, type, data, n)
            ORDER BY r.n`,
            [JSON.stringify(tick(t)), t, timeOf(t)],
          ),
        ),
      { discard: true },
    ),
  );
  await client.query('VACUUM ANALYZE emt_messages');
}

async function measurePostgreSQL(): Promise<void> {
  const administration = new Client({ connectionString: postgresqlServer });
  await administration.connect();
  const name = `ledger_measure_${Date.now()}`;
  await administration.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresqlServer);
  url.pathname = `/${name}`;
  const creating = await openLedgerWith(postgresqlLedgerLayer({ connectionString: url.href }));
  await creating.dispose();
  const client = new Client({ connectionString: url.href });
  await client.connect();
  await filledWithPostgreSQL(client);
  const pointAt = async ([stream, at]: readonly [string, number]): Promise<readonly [string, Point]> => {
    const { rows } = await client.query<{ readonly t: string; readonly p: string }>(
      'SELECT transaction_id::text AS t, global_position::text AS p FROM emt_messages WHERE stream_id = $1 AND stream_position = $2',
      [stream, at],
    );
    return [`${stream}#${at}`, rows.flatMap(({ t, p }) => [t, p])];
  };
  const points = new Map<string, Point>(
    await Effect.runPromise(Effect.forEach(needed, (point) => Effect.promise(() => pointAt(point)))),
  );
  const { rows } = await client.query<{ readonly n: string }>('SELECT count(*)::text AS n FROM emt_messages');
  write(`PostgreSQL, ${rows[0]?.n ?? '0'} messages:`);
  const othersWrite = async () => {
    await client.query(othersInPostgreSQL);
    await client.query('ANALYZE emt_messages');
  };
  await pagesOf(
    postgresqlLedgerLayer({ connectionString: url.href }),
    (stream, at) => points.get(`${stream}#${at}`) ?? [],
    othersWrite,
  );
  await client.end();
  await administration.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await administration.end();
}

await measureSQLite();
if (postgresqlServer !== '') {
  await measurePostgreSQL();
}
