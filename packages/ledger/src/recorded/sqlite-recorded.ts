import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { sqliteAppended } from '../appended/sqlite-appended.ts';
import { sqliteDefinitionStreams } from '../definitions/sqlite-definition-streams.ts';
import type { DefinitionStreamsStore, RecordedPoint, RecordedStore } from '../event-store.ts';
import {
  pointKey,
  recordedReadingOver,
  type ExaminationScope,
  type ExaminedItem,
  type RecordHead,
  type RecordedStatements,
  type RecordsSelected,
  type RunsSelected,
} from './recorded-statements.ts';
import { brainKeyOfStream, correlationOfMessage, kindKeyOfStream } from './sqlite-indexes.ts';

const defaultPartition = 'emt:default';

const Lineage = {
  id: Schema.String,
  causation: Schema.NullOr(Schema.String),
  correlation: Schema.NullOr(Schema.String),
};

const HeadFields = {
  position: Schema.Int,
  stream: Schema.String,
  version: Schema.Int,
  type: Schema.String,
  recorded: Schema.String,
  ...Lineage,
};

const ExaminedRecordRows = Schema.Array(
  Schema.Struct({ ...HeadFields, wanted: Schema.Int, size: Schema.Int, examined: Schema.Int }),
);

const ExaminedRunRow = Schema.Struct({
  ...HeadFields,
  examined: Schema.Int,
  size: Schema.Int,
  latest_position: Schema.Int,
  latest_version: Schema.Int,
  latest_type: Schema.String,
  latest_recorded: Schema.String,
  latest_size: Schema.Int,
  latest_id: Schema.String,
  latest_causation: Schema.NullOr(Schema.String),
  latest_correlation: Schema.NullOr(Schema.String),
  wanted: Schema.Int,
});

const PositionRows = Schema.Array(Schema.Struct({ position: Schema.Int }));

const DataRows = Schema.Array(Schema.Struct({ position: Schema.Int, data: Schema.fromJsonString(Schema.Unknown) }));

interface HeadRow {
  readonly position: number;
  readonly stream: string;
  readonly version: number;
  readonly type: string;
  readonly recorded: string;
  readonly id: string;
  readonly causation: string | null;
  readonly correlation: string | null;
  readonly size: number;
}

function headOf({ position, stream, version, type, recorded, id, causation, correlation, size }: HeadRow): RecordHead {
  return {
    point: [String(position)],
    id,
    causationId: causation,
    correlationId: correlation,
    stream,
    version,
    type,
    recordedAt: `${recorded.replace(' ', 'T')}.000Z`,
    size,
  };
}

function secondOf(since: string): string {
  return new Date(since).toISOString().slice(0, 19).replace('T', ' ');
}

function positionOf(point: RecordedPoint): number {
  return Number(point[0]);
}

function direction({ order }: ExaminationScope): SQL {
  return order === 'asc' ? SQL`ASC` : SQL`DESC`;
}

function beyond({ order, after, at }: ExaminationScope): SQL {
  if (after !== undefined) {
    return SQL` AND global_position ${SQL.plain(order === 'asc' ? '>' : '<')} ${positionOf(after)}`;
  }
  return at === undefined
    ? SQL.EMPTY
    : SQL` AND global_position ${SQL.plain(order === 'asc' ? '>=' : '<=')} ${positionOf(at)}`;
}

function bounds(scope: ExaminationScope): SQL {
  return SQL.concat(
    beyond(scope),
    scope.from === undefined ? SQL.EMPTY : SQL` AND global_position >= ${positionOf(scope.from)}`,
  );
}

function ofTypes(column: string, types: readonly string[] | undefined): SQL {
  return types === undefined
    ? SQL`1`
    : SQL`${SQL.plain(column)} IN (SELECT value FROM json_each(${JSON.stringify(types)}))`;
}

function sizeOf({ sized }: ExaminationScope, wanted: SQL, type: string, size: string): SQL {
  if (sized === undefined) {
    return SQL`CASE WHEN ${wanted} THEN ${SQL.plain(size)} ELSE 0 END`;
  }
  return sized.length === 0
    ? SQL`0`
    : SQL`CASE WHEN ${wanted} AND ${ofTypes(type, sized)} THEN ${SQL.plain(size)} ELSE 0 END`;
}

function recordsWhere(where: SQL, scope: ExaminationScope): SQL {
  return SQL`SELECT global_position AS position, stream_id AS stream, stream_position AS version,
      message_type AS type, created AS recorded,
      message_id AS id, json_extract(message_metadata, '$.causationId') AS causation,
      ${correlationOfMessage} AS correlation,
      ${ofTypes('message_type', scope.types)} AS wanted, octet_length(message_data) AS size
    FROM emt_messages
    WHERE ${where} AND partition = ${defaultPartition} AND is_archived = FALSE${bounds(scope)}
    ORDER BY global_position ${direction(scope)}
    LIMIT ${scope.examineAtMost + 1}`;
}

function recordsIn(selected: RecordsSelected, scope: ExaminationScope): SQL {
  if (selected.kind === 'brain') {
    return recordsWhere(SQL`${brainKeyOfStream} = ${scope.brainKey}`, scope);
  }
  if (selected.kind === 'correlated') {
    return recordsWhere(
      SQL`${brainKeyOfStream} = ${scope.brainKey} AND ${correlationOfMessage} = ${selected.correlation}`,
      scope,
    );
  }
  const ofEachStream = selected.streams.map(
    (stream) => SQL`SELECT * FROM (${recordsWhere(SQL`stream_id = ${stream}`, scope)})`,
  );
  return SQL`${SQL.merge(ofEachStream, ' UNION ALL ')}
    ORDER BY position ${direction(scope)}
    LIMIT ${scope.examineAtMost + 1}`;
}

function examineRecords(execute: SQLExecutor): RecordedStatements['examineRecords'] {
  return async (selected, scope) => {
    const { rows } = await execute.query(
      SQL`SELECT position, stream, version, type, recorded, id, causation, correlation, wanted,
          ${sizeOf(scope, SQL`wanted`, 'type', 'size')} AS size, examined
        FROM (
          SELECT scanned.*, row_number() OVER (ORDER BY scanned.position ${direction(scope)}) AS examined,
            count(*) OVER () AS scanned_count
          FROM (${recordsIn(selected, scope)}) AS scanned
        )
        WHERE wanted OR examined >= ${scope.examineAtMost} OR examined = scanned_count
        ORDER BY examined
        LIMIT ${scope.answerAtMost}`,
    );
    return Schema.decodeUnknownSync(ExaminedRecordRows)(rows).map((row): ExaminedItem => {
      const head = headOf(row);
      return { examined: row.examined, wanted: row.wanted === 1, size: row.size, point: head.point, heads: [head] };
    });
  };
}

function notOfTypes(column: string, types: readonly string[]): SQL {
  return types.length === 0 ? SQL`` : SQL` AND NOT ${ofTypes(column, types)}`;
}

function ofTheDefinitionAsked({ definitionType, name }: RunsSelected): SQL {
  const asked: SQL[] = [
    ...(definitionType === undefined
      ? []
      : [SQL`json_extract(message_data, '$.definition_type') IS ${definitionType}`]),
    ...(name === undefined ? [] : [SQL`json_extract(message_data, '$.name') IS ${name}`]),
  ];
  return asked.length === 0 ? SQL`1` : SQL.merge(asked, ' AND ');
}

function firstMessagesOfRuns(scope: ExaminationScope, runs: RunsSelected): SQL {
  return SQL`SELECT scanned.*, row_number() OVER (ORDER BY scanned.position ${direction(scope)}) AS examined,
      count(*) OVER () AS scanned_count
    FROM (
      SELECT global_position AS position, stream_id AS stream, stream_position AS version,
        message_type AS type, created AS recorded,
        message_id AS id, json_extract(message_metadata, '$.causationId') AS causation,
        ${correlationOfMessage} AS correlation, octet_length(message_data) AS size,
        ${ofTheDefinitionAsked(runs)} AS of_the_definition
      FROM emt_messages
      WHERE ${kindKeyOfStream} = ${`${scope.brainKey}runs/`} AND stream_position = 1
        AND partition = ${defaultPartition} AND is_archived = FALSE${bounds(scope)}${notOfTypes('message_type', runs.notBeginningWith ?? [])}
      ORDER BY global_position ${direction(scope)}
      LIMIT ${scope.examineAtMost + 1}
    ) AS scanned`;
}

function examinedRunOf(row: typeof ExaminedRunRow.Type): ExaminedItem {
  const first = headOf(row);
  const alone = row.latest_position === row.position;
  const wanted = row.wanted === 1;
  const latest = headOf({
    position: row.latest_position,
    stream: row.stream,
    version: row.latest_version,
    type: row.latest_type,
    recorded: row.latest_recorded,
    id: row.latest_id,
    causation: row.latest_causation,
    correlation: row.latest_correlation,
    size: row.latest_size,
  });
  return {
    examined: row.examined,
    wanted,
    size: row.size + (alone ? 0 : row.latest_size),
    point: first.point,
    heads: alone ? [first] : [first, latest],
  };
}

function examineRuns(execute: SQLExecutor): RecordedStatements['examineRuns'] {
  return async (scope, runs) => {
    const wanted = SQL`${ofTypes('latest.message_type', scope.types)} AND f.of_the_definition`;
    const { rows } = await execute.query(
      SQL`SELECT f.position, f.stream, f.version, f.type, f.recorded, f.id, f.causation, f.correlation, f.examined,
          ${sizeOf(scope, wanted, 'f.type', 'f.size')} AS size,
          latest.global_position AS latest_position, latest.stream_position AS latest_version,
          latest.message_type AS latest_type, latest.created AS latest_recorded,
          ${sizeOf(scope, wanted, 'latest.message_type', 'octet_length(latest.message_data)')} AS latest_size,
          latest.message_id AS latest_id, json_extract(latest.message_metadata, '$.causationId') AS latest_causation,
          json_extract(latest.message_metadata, '$.correlationId') AS latest_correlation, ${wanted} AS wanted
        FROM (${firstMessagesOfRuns(scope, runs)}) AS f
        JOIN emt_messages AS latest
          ON latest.stream_id = f.stream AND latest.partition = ${defaultPartition} AND latest.is_archived = FALSE
          AND latest.stream_position = (
            SELECT max(m.stream_position) FROM emt_messages AS m
            WHERE m.stream_id = f.stream AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
          )
        WHERE ${wanted} OR f.examined >= ${scope.examineAtMost} OR f.examined = f.scanned_count
        ORDER BY f.examined
        LIMIT ${scope.answerAtMost}`,
    );
    return Schema.decodeUnknownSync(Schema.Array(ExaminedRunRow))(rows).map((row) => examinedRunOf(row));
  };
}

function firstPointSince(execute: SQLExecutor): RecordedStatements['firstPointSince'] {
  return async (brainKey, since) => {
    const { rows } = await execute.query(
      SQL`SELECT global_position AS position FROM emt_messages
        WHERE ${brainKeyOfStream} = ${brainKey} AND partition = ${defaultPartition} AND is_archived = FALSE
          AND created >= ${secondOf(since)}
        ORDER BY created, global_position
        LIMIT 1`,
    );
    return Schema.decodeUnknownSync(PositionRows)(rows)
      .map(({ position }) => [String(position)])
      .at(0);
  };
}

function dataAt(execute: SQLExecutor): RecordedStatements['dataAt'] {
  return async (points) => {
    const positions = points.map((point) => positionOf(point));
    const { rows } = await execute.query(
      SQL`SELECT global_position AS position, message_data AS data FROM emt_messages
        WHERE global_position IN (SELECT value FROM json_each(${JSON.stringify(positions)}))`,
    );
    return new Map(
      Schema.decodeUnknownSync(DataRows)(rows).map(({ position, data }) => [pointKey([String(position)]), data]),
    );
  };
}

export function sqliteRecordedStore(execute: SQLExecutor): RecordedStore & DefinitionStreamsStore {
  return {
    ...sqliteDefinitionStreams(execute),
    pointLength: 1,
    readAppended: sqliteAppended(execute),
    readRecorded: recordedReadingOver({
      firstPointSince: firstPointSince(execute),
      examineRecords: examineRecords(execute),
      examineRuns: examineRuns(execute),
      dataAt: dataAt(execute),
    }),
  };
}
