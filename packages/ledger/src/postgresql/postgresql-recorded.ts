import { Schema } from 'effect';

import type { DefinitionStreamsStore, RecordedStore } from '../event-store.ts';
import {
  pointKey,
  recordedReadingOver,
  type ExaminationScope,
  type ExaminedItem,
  type RecordedStatements,
  type RecordsSelected,
} from '../recorded/recorded-statements.ts';
import { brainKeyOfStream, correlationOfMessage } from './brain-indexes.ts';
import { dataAsJsonText } from './json-text.ts';
import { postgresqlDefinitionStreams } from './postgresql-definition-streams.ts';
import { examineRuns } from './postgresql-runs.ts';
import {
  binding,
  bounds,
  defaultPartition,
  direction,
  HeadFields,
  headOf,
  horizonOf,
  lineageColumns,
  matchedThroughItsIndex,
  ofTypes,
  PointFields,
  timeOf,
  type Bind,
  type Query,
} from './recorded-parts.ts';

export type { Query } from './recorded-parts.ts';

const ExaminedRecordRows = Schema.Array(
  Schema.Struct({ ...HeadFields, wanted: Schema.Boolean, size: Schema.Int, examined: Schema.Int }),
);

const PointRows = Schema.Array(Schema.Struct(PointFields));

const DataRows = Schema.Array(Schema.Struct({ ...PointFields, data: Schema.Struct({ json: Schema.String }) }));

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

interface Keyed {
  readonly key: string;
  readonly value: string;
}

function recordsWhere(keys: readonly Keyed[], records: RecordsScope): string {
  const matched = keys.map(({ key, value }) => matchedThroughItsIndex(records.bind, key, value)).join(' AND ');
  const ordered = keys.map(({ key }) => `${key} ${direction(records.scope)}`).join(', ');
  return `SELECT transaction_id, global_position, transaction_id::text AS transaction, global_position::text AS position,
      stream_id AS stream, message_type AS type, ${timeOf('created')} AS recorded, ${lineageColumns},
      ${records.wanted} AS wanted, message_data
    FROM emt_messages
    WHERE ${matched} AND partition = ${records.partition}
      AND is_archived = FALSE${horizonOf(records.scope)}${records.bounded}
    ORDER BY ${ordered}, ${inOrder(records)}
    LIMIT ${records.limit}`;
}

function recordsIn(selected: RecordsSelected, records: RecordsScope): string {
  const brain = { key: brainKeyOfStream, value: records.scope.brainKey };
  if (selected.kind === 'brain') {
    return recordsWhere([brain], records);
  }
  if (selected.kind === 'correlated') {
    return recordsWhere([brain, { key: correlationOfMessage, value: selected.correlation }], records);
  }
  const ofEachStream = selected.streams.map(
    (stream) => `(${recordsWhere([{ key: 'stream_id', value: stream }], records)})`,
  );
  return `${ofEachStream.join(' UNION ALL ')} ORDER BY ${inOrder(records)} LIMIT ${records.limit}`;
}

function examineRecords(query: Query): RecordedStatements['examineRecords'] {
  return async (selected, scope) => {
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
      `SELECT transaction, position, stream, type, recorded, id, causation, correlation, wanted,
          examined::int AS examined,
          CASE WHEN wanted THEN octet_length(message_data ->> 'json') ELSE 0 END AS size
        FROM (
          SELECT scanned.*, row_number() OVER (ORDER BY ${inOrder(records, 'scanned.')}) AS examined,
            count(*) OVER () AS scanned_count
          FROM (${recordsIn(selected, records)}) AS scanned
        ) AS numbered
        WHERE wanted OR examined >= ${bind(scope.examineAtMost)} OR examined = scanned_count
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

export function postgresqlRecordedStore(query: Query): RecordedStore & DefinitionStreamsStore {
  return {
    ...postgresqlDefinitionStreams(query),
    pointLength: 2,
    readRecorded: recordedReadingOver({
      firstPointSince: firstPointSince(query),
      examineRecords: examineRecords(query),
      examineRuns: examineRuns(query),
      dataAt: dataAt(query),
    }),
  };
}
