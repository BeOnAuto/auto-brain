import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { Ledger } from '@beonauto/operations';
import { Effect, type Layer } from 'effect';
import { Client } from 'pg';

import { postgresqlLedgerLayer } from './src/postgresql/postgresql-ledger.ts';
import { cursorOf } from './src/recorded/cursor.ts';
import { ledgerLayer } from './src/sqlite3.ts';
import { openLedgerWith, type OpenLedger } from './src/testing/open-ledger.ts';
import { temporaryDatabase } from './src/testing/temporary-database.ts';

type AnyLedger = OpenLedger['ledger'];

type Selection = Parameters<AnyLedger['readRecorded']>[1];

type Page = Parameters<AnyLedger['readRecorded']>[2];

type Point = readonly string[];

interface Row {
  readonly stream: string;
  readonly position: number;
  readonly type: string;
  readonly data: string;
}

interface Case {
  readonly label: string;
  readonly selection: Selection;
  readonly page: Page;
}

const runs = Number(process.env['LEDGER_MEASURE_RUNS'] ?? 100_000);

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const brain = { org: 'o1', brain: 'big' };

const brainKey = 'brain/o1/big/';

const largeEvery = 200;

const repetitions = 20;

const indexes = ['ledger_messages_by_brain', 'ledger_messages_by_brain_and_time', 'ledger_first_messages_by_kind'];

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function statusOf(run: number): string {
  if (run % largeEvery === 13) {
    return 'succeeded';
  }
  const statuses: readonly (readonly [number, number, string])[] = [
    [100, 7, 'failed'],
    [20, 5, 'rejected'],
    [25, 3, 'deferred'],
    [33, 1, 'running'],
  ];
  return statuses.find(([every, at]) => run % every === at)?.[2] ?? 'succeeded';
}

function text(characters: number): string {
  return randomBytes(characters / 2).toString('hex');
}

function timeOf(second: number): string {
  return new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString();
}

function executions(run: number): string {
  return `brain/o1/big/executions/${String(run).padStart(8, '0')}`;
}

function finishOf(run: number, at: string): readonly Row[] {
  const status = statusOf(run);
  const facts: Readonly<Record<string, object>> = {
    failed: {},
    rejected: { rejection: { reason: 'unavailable', detail: 'try again later' } },
    deferred: { record: {} },
    succeeded: { output: { text: text(run % largeEvery === 13 ? 1_048_576 : 640) }, record: {} },
  };
  const type = `execution_${status}`;
  const data = JSON.stringify({ type, ...facts[status], by: 'user-1', at });
  return run < 0 || status === 'running' ? [] : [{ stream: executions(run), position: 2, type, data }];
}

function tick(t: number): readonly Row[] {
  const at = timeOf(t);
  const input = { text: text(t % largeEvery === 13 ? 262_144 : 320) };
  const start = { type: 'execution_started', primitive: 'inference', name: `spec-${t % 50}`, spec_version: 1, input };
  const inputs = Array.from({ length: t % 10 === 0 ? 20 : 0 }, (_, index) => ({
    stream: `brain/o1/big/runs/${String(t).padStart(8, '0')}`,
    position: index + 1,
    type: 'input_applied',
    data: JSON.stringify({ type: 'input_applied', patch: text(2048) }),
  }));
  const others = Array.from({ length: 7 }, (_, index) => ({
    stream: `brain/o2/other-${t % 99}/executions/${t}-${index}`,
    position: 1,
    type: 'execution_started',
    data: JSON.stringify({ type: 'execution_started', input: text(512) }),
  }));
  const started = {
    stream: executions(t),
    position: 1,
    type: start.type,
    data: JSON.stringify({ ...start, by: 'user-1', at }),
  };
  return [started, ...finishOf(t - 1, at), ...inputs, ...others];
}

function aPage(order: 'asc' | 'desc', limit: number, more: Omit<Page, 'order' | 'limit'> = {}): Page {
  return { order, limit, ...more };
}

function casesOf(selection: Selection, pages: readonly (readonly [string, Page])[]): readonly Case[] {
  return pages.map(([label, onePage]) => ({ label, selection, page: onePage }));
}

function cases(pointOf: (run: number) => Point): readonly Case[] {
  const cursor = cursorOf(brainKey, pointOf(50_000));
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
        aPage('desc', 20, { cursor: cursorOf(brainKey, pointOf(50_015)) }),
      ],
      ['The brain, of one rare type, newest first', aPage('desc', 20, { types: ['execution_failed'] })],
      ['The brain since a time, oldest first', aPage('asc', 20, { since })],
      ['The brain since a time, newest first', aPage('desc', 20, { since })],
    ]),
    ...casesOf({ kind: 'run', execution: '00050000' }, [
      ['One run of 21 messages, oldest first', aPage('asc', 20)],
      ['One run of 21 messages, newest first', aPage('desc', 20)],
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

async function timed<A>(attempt: () => Promise<A>): Promise<{ readonly took: number; readonly answer: A }> {
  const started = performance.now();
  const answer = await attempt();
  return { took: performance.now() - started, answer };
}

async function measured(ledger: AnyLedger, { label, selection, page }: Case): Promise<string> {
  const read = () => Effect.runPromise(ledger.readRecorded(brain, selection, page));
  await Effect.runPromise(Effect.forEach([1, 2, 3], () => Effect.promise(read), { discard: true }));
  const reads = await Effect.runPromise(
    Effect.forEach(Array.from({ length: repetitions }), () => Effect.promise(() => timed(read))),
  );
  const times = reads.map(({ took }) => took).toSorted((left, right) => left - right);
  const { records } = reads[0]?.answer ?? { records: [] };
  const kibibytes = Math.round(JSON.stringify(records).length / 1024);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  return `| ${label} | ${median.toFixed(2)} | ${Math.max(...times).toFixed(2)} | ${records.length} | ${kibibytes} KiB |`;
}

async function pagesOf(layer: Layer.Layer<Ledger>, pointOf: (run: number) => Point): Promise<void> {
  const building = await timed(() => openLedgerWith(layer));
  write(`The ledger opened and built its indexes in ${Math.round(building.took)} ms.`);
  await building.answer.dispose();
  const { ledger, dispose } = await openLedgerWith(layer);
  write('| Page | median ms | slowest ms | records | data |');
  write('| --- | --- | --- | --- | --- |');
  const lines = await Effect.runPromise(
    Effect.forEach(cases(pointOf), (each) => Effect.promise(() => measured(ledger, each))),
  );
  write(lines.join('\n'));
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
    for (const [index, row] of tick(t).entries()) {
      insert.run(row.stream, row.position, row.data, row.type, `m${t}-${index}`, created);
    }
  }
  database.exec('COMMIT');
  const position = database.prepare(
    'SELECT global_position AS p FROM emt_messages WHERE stream_id = ? AND stream_position = 1',
  );
  const points = new Map([50_000, 50_015].map((run) => [run, [String(position.get(executions(run))?.['p'])]]));
  const count = database.prepare('SELECT count(*) AS n FROM emt_messages').get()?.['n'];
  database.close();
  write(`SQLite, ${String(count)} messages:`);
  await pagesOf(ledgerLayer({ fileName }), (run) => points.get(run) ?? []);
  remove();
}

async function filledWithPostgreSQL(client: Readonly<Pick<Client, 'query'>>): Promise<void> {
  await client.query(`DROP INDEX ${indexes.join(', ')}`);
  await client.query('SET synchronous_commit = off');
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: runs }, (_, t) => t),
      (t) => {
        const rows = tick(t);
        return Effect.promise(() =>
          client.query(
            `INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind, message_data,
              message_metadata, message_schema_version, message_type, message_id, is_archived, transaction_id, created)
            SELECT stream_id, stream_position, 'emt:default', 'E', jsonb_build_object('json', data), '{}', '1',
              message_type, 'm' || $5 || '-' || ordinality, false, pg_current_xact_id(), $6::timestamptz
            FROM unnest($1::text[], $2::int[], $3::text[], $4::text[]) WITH ORDINALITY
              AS r(stream_id, stream_position, message_type, data, ordinality)
            ORDER BY ordinality`,
            [
              rows.map((r) => r.stream),
              rows.map((r) => r.position),
              rows.map((r) => r.type),
              rows.map((r) => r.data),
              t,
              timeOf(t),
            ],
          ),
        );
      },
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
  const pointOf = async (run: number): Promise<Point> => {
    const { rows } = await client.query<{ readonly t: string; readonly p: string }>(
      'SELECT transaction_id::text AS t, global_position::text AS p FROM emt_messages WHERE stream_id = $1 AND stream_position = 1',
      [executions(run)],
    );
    return rows.flatMap(({ t, p }) => [t, p]);
  };
  const points = new Map<number, Point>([
    [50_000, await pointOf(50_000)],
    [50_015, await pointOf(50_015)],
  ]);
  const { rows } = await client.query<{ readonly n: string }>('SELECT count(*)::text AS n FROM emt_messages');
  write(`PostgreSQL, ${rows[0]?.n ?? '0'} messages:`);
  await pagesOf(postgresqlLedgerLayer({ connectionString: url.href }), (run) => points.get(run) ?? []);
  await client.end();
  await administration.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await administration.end();
}

await measureSQLite();
if (postgresqlServer !== '') {
  await measurePostgreSQL();
}
