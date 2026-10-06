import { DatabaseSync } from 'node:sqlite';

import type { Ledger, RunOutcomeMapping } from '@beonauto/operations';
import { Effect, type Layer } from 'effect';
import { Client } from 'pg';

import { postgresqlLedgerLayer } from '../src/postgresql/postgresql-ledger.ts';
import { ledgerLayer } from '../src/sqlite3.ts';
import { temporaryDatabase } from '../src/testing/temporary-database.ts';
import { firstDay, lastDay, type OutcomeRow } from './outcomes-dataset.ts';

interface Place {
  readonly location: string;
  readonly drop: () => Promise<void>;
}

type RowsOf = (index: number) => readonly OutcomeRow[];

export interface Bench {
  readonly store: string;
  readonly aPlace: () => Promise<Place>;
  readonly ledgerOn: (place: Place, runOutcomes?: RunOutcomeMapping) => Layer.Layer<Ledger>;
  readonly write: (place: Place, count: number, rowsOf: RowsOf) => Promise<void>;
  readonly aggregate: (place: Place) => Promise<number>;
}

const runsInAWrite = 200;

function batchesOf(count: number): readonly number[] {
  return Array.from({ length: Math.ceil(count / runsInAWrite) }, (_, batch) => batch * runsInAWrite);
}

function rowsFrom(first: number, count: number, rowsOf: RowsOf): readonly OutcomeRow[] {
  return Array.from({ length: Math.min(runsInAWrite, count - first) }, (_, offset) => rowsOf(first + offset)).flat();
}

function kindKeyOfStream(): string {
  return Array.from({ length: 3 }).reduce<string>(
    (found) => `${found} + instr(substr(stream_id, ${found} + 1), '/')`,
    "instr(stream_id, '/')",
  );
}

const sqliteAggregate = `SELECT coalesce(sum(runs), 0) AS runs FROM (
  SELECT substr(json_extract(s.message_data, '$.at'), 1, 10) AS day, json_extract(s.message_data, '$.primitive') AS primitive,
    json_extract(s.message_data, '$.name') AS name, f.message_type AS status, count(*) AS runs,
    sum(json_extract(f.message_data, '$.record.usage.input.total')) AS input_tokens,
    sum(json_extract(f.message_data, '$.record.usage.output.total')) AS output_tokens,
    sum(json_extract(f.message_data, '$.record.usage.input.cache_read')) AS cached_tokens,
    json_group_array(CAST((julianday(json_extract(f.message_data, '$.at'))
      - julianday(json_extract(s.message_data, '$.at'))) * 86400000 AS INTEGER)) AS durations
  FROM (
    SELECT stream_id, message_data FROM emt_messages
    WHERE substr(stream_id, 1, ${kindKeyOfStream()}) = 'brain/o1/big/executions/' AND stream_position = 1
  ) AS s
  JOIN emt_messages AS f ON f.stream_id = s.stream_id AND f.stream_position = (
    SELECT max(m.stream_position) FROM emt_messages AS m WHERE m.stream_id = s.stream_id)
  WHERE substr(json_extract(s.message_data, '$.at'), 1, 10) BETWEEN '${firstDay}' AND '${lastDay}'
  GROUP BY day, primitive, name, status)`;

function sqliteWrite(fileName: string, count: number, rowsOf: RowsOf): void {
  const database = new DatabaseSync(fileName);
  const message = database.prepare(`INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind,
    message_data, message_metadata, message_schema_version, message_type, message_id, is_archived, created)
    VALUES (?, ?, 'emt:default', 'E', ?, '{}', '1', ?, ?, 0, ?)`);
  const stream = database.prepare(`INSERT INTO emt_streams (stream_id, stream_position, partition, stream_type,
    stream_metadata, is_archived) VALUES (?, ?, 'emt:default', 'brain', '[]', 0)
    ON CONFLICT DO UPDATE SET stream_position = excluded.stream_position`);
  for (const first of batchesOf(count)) {
    database.exec('BEGIN');
    for (const [index, row] of rowsFrom(first, count, rowsOf).entries()) {
      message.run(
        row.stream,
        row.position,
        row.data,
        row.type,
        `m${first}-${index}`,
        row.created.slice(0, 19).replace('T', ' '),
      );
      stream.run(row.stream, row.position);
    }
    database.exec('COMMIT');
  }
  database.close();
}

export const onSQLite: Bench = {
  store: 'SQLite',
  aPlace: () => {
    const { fileName, remove } = temporaryDatabase();
    const drop = async (): Promise<void> => {
      await Promise.resolve();
      remove();
    };
    return Promise.resolve({ location: fileName, drop });
  },
  ledgerOn: ({ location }, runOutcomes) =>
    ledgerLayer({ fileName: location, ...(runOutcomes === undefined ? {} : { runOutcomes }) }),
  write: async ({ location }, count, rowsOf) => {
    await Promise.resolve();
    sqliteWrite(location, count, rowsOf);
  },
  aggregate: ({ location }) => {
    const database = new DatabaseSync(location);
    const runs = Number(database.prepare(sqliteAggregate).get()?.['runs']);
    database.close();
    return Promise.resolve(runs);
  },
};

const postgresqlAggregate = `WITH s AS (
    SELECT stream_id, (message_data ->> 'json')::jsonb AS e FROM emt_messages
    WHERE substring(stream_id FROM '^(?:[^/]*/){4}') = ANY($1::text[]) AND stream_position = 1
  ), runs AS (
    SELECT left(s.e ->> 'at', 10) AS day, s.e ->> 'primitive' AS primitive, s.e ->> 'name' AS name,
      latest.message_type AS status, (latest.message_data ->> 'json')::jsonb AS f, s.e ->> 'at' AS started_at
    FROM s CROSS JOIN LATERAL (
      SELECT message_type, message_data FROM emt_messages AS m WHERE m.stream_id = s.stream_id
      ORDER BY m.transaction_id DESC, m.global_position DESC LIMIT 1
    ) AS latest
    WHERE left(s.e ->> 'at', 10) BETWEEN $2 AND $3
  )
  SELECT coalesce(sum(runs), 0)::int AS runs FROM (
    SELECT day, primitive, name, status, count(*) AS runs,
      sum((f -> 'record' -> 'usage' -> 'input' ->> 'total')::bigint) AS input_tokens,
      sum((f -> 'record' -> 'usage' -> 'output' ->> 'total')::bigint) AS output_tokens,
      sum((f -> 'record' -> 'usage' -> 'input' ->> 'cache_read')::bigint) AS cached_tokens,
      json_agg((extract(epoch FROM (f ->> 'at')::timestamptz - started_at::timestamptz) * 1000)::bigint) AS durations
    FROM runs GROUP BY day, primitive, name, status
  ) AS groups`;

const postgresqlRows = `INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind, message_data,
    message_metadata, message_schema_version, message_type, message_id, is_archived, transaction_id, created)
  SELECT r.stream, r.position, 'emt:default', 'E', jsonb_build_object('json', r.data), '{}', '1', r.type,
    'm' || $2 || '-' || r.n, false, pg_current_xact_id(), r.created::timestamptz
  FROM ROWS FROM (jsonb_to_recordset($1::jsonb) AS (stream text, position int, type text, data text, created text))
    WITH ORDINALITY AS r(stream, position, type, data, created, n)
  ORDER BY r.n`;

const postgresqlStreams = `INSERT INTO emt_streams (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
  SELECT stream, max(position), 'emt:default', 'brain', '{}', false
  FROM jsonb_to_recordset($1::jsonb) AS r(stream text, position int) GROUP BY stream
  ON CONFLICT (stream_id, partition, is_archived) DO UPDATE SET stream_position = excluded.stream_position`;

async function connected<A>(
  location: string,
  use: (client: Readonly<Pick<Client, 'query'>>) => Promise<A>,
): Promise<A> {
  const client = new Client({ connectionString: location });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

export function onPostgreSQL(server: string): Bench {
  return {
    store: 'PostgreSQL',
    aPlace: async () => {
      const name = `outcomes_measure_${Date.now()}`;
      await connected(server, (client) => client.query(`CREATE DATABASE ${name}`));
      const url = new URL(server);
      url.pathname = `/${name}`;
      const drop = async () => {
        await connected(server, (client) => client.query(`DROP DATABASE ${name} WITH (FORCE)`));
      };
      return { location: url.href, drop };
    },
    ledgerOn: ({ location }, runOutcomes) =>
      postgresqlLedgerLayer({ connectionString: location, ...(runOutcomes === undefined ? {} : { runOutcomes }) }),
    write: ({ location }, count, rowsOf) =>
      connected(location, async (client) => {
        await client.query('SET synchronous_commit = off');
        await Effect.runPromise(
          Effect.forEach(
            batchesOf(count),
            (first) =>
              Effect.promise(async () => {
                const rows = rowsFrom(first, count, rowsOf);
                await client.query(postgresqlRows, [JSON.stringify(rows), first]);
                await client.query(postgresqlStreams, [
                  JSON.stringify(rows.map(({ stream, position }) => ({ stream, position }))),
                ]);
              }),
            { discard: true },
          ),
        );
        await client.query('VACUUM ANALYZE emt_messages');
      }),
    aggregate: ({ location }) =>
      connected(location, async (client) => {
        const { rows } = await client.query<{ readonly runs: number }>(postgresqlAggregate, [
          ['brain/o1/big/executions/'],
          firstDay,
          lastDay,
        ]);
        return rows[0]?.runs ?? 0;
      }),
  };
}
