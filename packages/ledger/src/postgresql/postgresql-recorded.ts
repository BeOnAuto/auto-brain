import { Schema } from 'effect';

import type { RecordedPoint, RecordedStore } from '../event-store.ts';
import {
  pointKey,
  recordedReadingOver,
  type ExaminationScope,
  type ExaminedItem,
  type RecordHead,
  type RecordedStatements,
} from '../recorded/recorded-statements.ts';
import { brainKeyOfStream, kindKeyOfStream } from './brain-indexes.ts';
import { dataAsJsonText } from './json-text.ts';

export type Query = (text: string, values: readonly unknown[]) => Promise<readonly unknown[]>;

export type Bind = (value: unknown) => string;

const defaultPartition = 'emt:default';

const oldestWriteOfThisDatabase = `(
  SELECT coalesce(min(running.xid), pg_snapshot_xmax(pg_current_snapshot()))
  FROM pg_snapshot_xip(pg_current_snapshot()) AS running(xid)
  WHERE running.xid::text::bigint % 4294967296 NOT IN (
    SELECT backend_xid::text::bigint FROM pg_stat_activity
    WHERE backend_xid IS NOT NULL AND datname IS DISTINCT FROM current_database()
  )
)`;

const belowTheHorizon = `transaction_id < ${oldestWriteOfThisDatabase}`;

const PointFields = { transaction: Schema.String, position: Schema.String };

const HeadFields = { ...PointFields, stream: Schema.String, type: Schema.String, recorded: Schema.String };

const ExaminedRecordRows = Schema.Array(
  Schema.Struct({ ...HeadFields, wanted: Schema.Boolean, size: Schema.Int, examined: Schema.Int }),
);

const ExaminedRunRow = Schema.Struct({
  ...HeadFields,
  examined: Schema.Int,
  latest_transaction: Schema.String,
  latest_position: Schema.String,
  latest_type: Schema.String,
  latest_recorded: Schema.String,
  wanted: Schema.Boolean,
  size: Schema.Int,
});

const PointRows = Schema.Array(Schema.Struct(PointFields));

const DataRows = Schema.Array(Schema.Struct({ ...PointFields, data: Schema.Struct({ json: Schema.String }) }));

function timeOf(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

export function binding(): { readonly values: readonly unknown[]; readonly bind: Bind } {
  const values: unknown[] = [];
  return {
    values,
    bind: (value) => {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

function direction({ order }: ExaminationScope): string {
  return order === 'asc' ? 'ASC' : 'DESC';
}

function pointAt(bind: Bind, [transaction, position]: RecordedPoint): string {
  return `(${bind(transaction)}::xid8, ${bind(position)}::bigint)`;
}

function bounds(bind: Bind, { order, after, from }: ExaminationScope): string {
  const beyond =
    after === undefined
      ? ''
      : ` AND (transaction_id, global_position) ${order === 'asc' ? '>' : '<'} ${pointAt(bind, after)}`;
  return from === undefined ? beyond : `${beyond} AND (transaction_id, global_position) >= ${pointAt(bind, from)}`;
}

function horizonOf({ order }: ExaminationScope): string {
  return order === 'asc' ? ` AND ${belowTheHorizon}` : '';
}

function matchedThroughItsIndex(bind: Bind, key: string, value: string): string {
  return `${key} = ANY(${bind([value])}::text[])`;
}

function orderedThroughItsIndex(key: string, scope: ExaminationScope): string {
  return `${key} ${direction(scope)}, transaction_id ${direction(scope)}, global_position ${direction(scope)}`;
}

function ofTypes(bind: Bind, column: string, types: readonly string[] | undefined): string {
  return types === undefined ? 'TRUE' : `${column} = ANY(${bind(types)}::text[])`;
}

interface HeadRow {
  readonly transaction: string;
  readonly position: string;
  readonly stream: string;
  readonly type: string;
  readonly recorded: string;
}

function headOf({ transaction, position, stream, type, recorded }: HeadRow): RecordHead {
  return { point: [transaction, position], stream, type, recordedAt: recorded };
}

interface RecordsScope {
  readonly bind: Bind;
  readonly scope: ExaminationScope;
  readonly wanted: string;
  readonly partition: string;
  readonly bounded: string;
  readonly limit: string;
}

function inOrder({ scope }: RecordsScope, prefix = ''): string {
  return `${prefix}transaction_id ${direction(scope)}, ${prefix}global_position ${direction(scope)}`;
}

function recordsWhere(key: string, value: string, records: RecordsScope): string {
  return `SELECT transaction_id, global_position, transaction_id::text AS transaction, global_position::text AS position,
      stream_id AS stream, message_type AS type, ${timeOf('created')} AS recorded, ${records.wanted} AS wanted, message_data
    FROM emt_messages
    WHERE ${matchedThroughItsIndex(records.bind, key, value)} AND partition = ${records.partition}
      AND is_archived = FALSE${horizonOf(records.scope)}${records.bounded}
    ORDER BY ${orderedThroughItsIndex(key, records.scope)}
    LIMIT ${records.limit}`;
}

function recordsIn(streams: readonly string[] | undefined, records: RecordsScope): string {
  if (streams === undefined) {
    return recordsWhere(brainKeyOfStream, records.scope.brainKey, records);
  }
  const ofEachStream = streams.map((stream) => `(${recordsWhere('stream_id', stream, records)})`);
  return `${ofEachStream.join(' UNION ALL ')} ORDER BY ${inOrder(records)} LIMIT ${records.limit}`;
}

function examineRecords(query: Query): RecordedStatements['examineRecords'] {
  return async (streams, scope) => {
    const { values, bind } = binding();
    const records: RecordsScope = {
      bind,
      scope,
      wanted: ofTypes(bind, 'message_type', scope.types),
      partition: bind(defaultPartition),
      bounded: bounds(bind, scope),
      limit: bind(scope.examineAtMost + 1),
    };
    const rows = await query(
      `SELECT transaction, position, stream, type, recorded, wanted, examined::int AS examined,
          CASE WHEN wanted THEN octet_length(message_data ->> 'json') ELSE 0 END AS size
        FROM (
          SELECT scanned.*, row_number() OVER (ORDER BY ${inOrder(records, 'scanned.')}) AS examined
          FROM (${recordsIn(streams, records)}) AS scanned
        ) AS numbered
        WHERE wanted OR examined >= ${bind(scope.examineAtMost)}
        ORDER BY ${inOrder(records)}
        LIMIT ${bind(scope.answerAtMost)}`,
      values,
    );
    return Schema.decodeUnknownSync(ExaminedRecordRows)(rows).map((row): ExaminedItem => {
      const head = headOf(row);
      return { examined: row.examined, wanted: row.wanted, size: row.size, point: head.point, heads: [head] };
    });
  };
}

function firstMessagesOfRuns(bind: Bind, partition: string, scope: ExaminationScope): string {
  return `SELECT scanned.*, row_number() OVER (
      ORDER BY scanned.transaction_id ${direction(scope)}, scanned.global_position ${direction(scope)}
    ) AS examined
    FROM (
      SELECT transaction_id, global_position, transaction_id::text AS transaction,
        global_position::text AS position, stream_id AS stream, message_type AS type,
        ${timeOf('created')} AS recorded, message_data
      FROM emt_messages
      WHERE ${matchedThroughItsIndex(bind, kindKeyOfStream, `${scope.brainKey}executions/`)} AND stream_position = 1
        AND partition = ${partition} AND is_archived = FALSE
        ${horizonOf(scope)}${bounds(bind, scope)}
      ORDER BY ${orderedThroughItsIndex(kindKeyOfStream, scope)}
      LIMIT ${bind(scope.examineAtMost + 1)}
    ) AS scanned`;
}

function examinedRunOf(row: typeof ExaminedRunRow.Type): ExaminedItem {
  const first = headOf(row);
  const alone = row.latest_transaction === row.transaction && row.latest_position === row.position;
  const latest = headOf({
    transaction: row.latest_transaction,
    position: row.latest_position,
    stream: row.stream,
    type: row.latest_type,
    recorded: row.latest_recorded,
  });
  return {
    examined: row.examined,
    wanted: row.wanted,
    size: row.size,
    point: first.point,
    heads: alone ? [first] : [first, latest],
  };
}

function examineRuns(query: Query): RecordedStatements['examineRuns'] {
  return async (scope) => {
    const { values, bind } = binding();
    const wanted = ofTypes(bind, 'latest.message_type', scope.types);
    const partition = bind(defaultPartition);
    const rows = await query(
      `SELECT f.transaction, f.position, f.stream, f.type, f.recorded, f.examined::int AS examined,
          latest.transaction_id::text AS latest_transaction, latest.global_position::text AS latest_position,
          latest.message_type AS latest_type, ${timeOf('latest.created')} AS latest_recorded, ${wanted} AS wanted,
          CASE WHEN ${wanted} THEN octet_length(f.message_data ->> 'json')
            + CASE WHEN latest.stream_position = 1 THEN 0 ELSE octet_length(latest.message_data ->> 'json') END
          ELSE 0 END AS size
        FROM (${firstMessagesOfRuns(bind, partition, scope)}) AS f
        CROSS JOIN LATERAL (
          SELECT transaction_id, global_position, stream_position, message_type, created, message_data
          FROM emt_messages AS m
          WHERE m.stream_id = f.stream AND m.partition = ${partition} AND m.is_archived = FALSE
          ORDER BY m.transaction_id DESC, m.global_position DESC
          LIMIT 1
        ) AS latest
        WHERE ${wanted} OR f.examined >= ${bind(scope.examineAtMost)}
        ORDER BY f.transaction_id ${direction(scope)}, f.global_position ${direction(scope)}
        LIMIT ${bind(scope.answerAtMost)}`,
      values,
    );
    return Schema.decodeUnknownSync(Schema.Array(ExaminedRunRow))(rows).map((row) => examinedRunOf(row));
  };
}

function firstPointSince(query: Query): RecordedStatements['firstPointSince'] {
  return async (brainKey, since) => {
    const { values, bind } = binding();
    const rows = await query(
      `SELECT transaction_id::text AS transaction, global_position::text AS position FROM emt_messages
        WHERE ${brainKeyOfStream} = ${bind(brainKey)} AND partition = ${bind(defaultPartition)}
          AND is_archived = FALSE AND created >= ${bind(since)}::timestamptz
        ORDER BY created, transaction_id, global_position
        LIMIT 1`,
      values,
    );
    return Schema.decodeUnknownSync(PointRows)(rows)
      .map(({ transaction, position }) => [transaction, position])
      .at(0);
  };
}

function dataAt(query: Query): RecordedStatements['dataAt'] {
  return async (points) => {
    const { values, bind } = binding();
    const rows = await query(
      `SELECT m.transaction_id::text AS transaction, m.global_position::text AS position, m.message_data AS data
        FROM unnest(${bind(points.map(([transaction]) => transaction))}::xid8[],
          ${bind(points.map(([, position]) => position))}::bigint[]) AS wanted(transaction_id, global_position)
        JOIN emt_messages AS m
          ON m.transaction_id = wanted.transaction_id AND m.global_position = wanted.global_position
        WHERE m.partition = ${bind(defaultPartition)} AND m.is_archived = FALSE`,
      values,
    );
    return new Map(
      Schema.decodeUnknownSync(DataRows)(rows).map(({ transaction, position, data }) => [
        pointKey([transaction, position]),
        dataAsJsonText.read(data),
      ]),
    );
  };
}

export function postgresqlRecordedStore(query: Query): RecordedStore {
  return {
    pointLength: 2,
    readRecorded: recordedReadingOver({
      firstPointSince: firstPointSince(query),
      examineRecords: examineRecords(query),
      examineRuns: examineRuns(query),
      dataAt: dataAt(query),
    }),
  };
}
