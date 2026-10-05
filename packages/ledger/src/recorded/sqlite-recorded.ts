import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { RecordedPoint, RecordedStore } from '../event-store.ts';
import { createMissingIndexes, type BrainIndex, type IndexExecutor } from './missing-indexes.ts';
import {
  pointKey,
  recordedReadingOver,
  type ExaminationScope,
  type ExaminedItem,
  type RecordHead,
  type RecordedStatements,
} from './recorded-statements.ts';

function prefixThroughSlashes(count: number): SQL {
  const end = Array.from({ length: count - 1 }).reduce<string>(
    (found) => `${found} + instr(substr(stream_id, ${found} + 1), '/')`,
    "instr(stream_id, '/')",
  );
  return SQL`${SQL.plain(`substr(stream_id, 1, ${end})`)}`;
}

const brainKeyOfStream = prefixThroughSlashes(3);

const kindKeyOfStream = prefixThroughSlashes(4);

const defaultPartition = 'emt:default';

const HeadFields = { position: Schema.Int, stream: Schema.String, type: Schema.String, recorded: Schema.String };

const ExaminedRecordRows = Schema.Array(
  Schema.Struct({ ...HeadFields, wanted: Schema.Int, size: Schema.Int, examined: Schema.Int }),
);

const ExaminedRunRow = Schema.Struct({
  ...HeadFields,
  examined: Schema.Int,
  size: Schema.Int,
  latest_position: Schema.Int,
  latest_type: Schema.String,
  latest_recorded: Schema.String,
  latest_size: Schema.Int,
  wanted: Schema.Int,
});

const PositionRows = Schema.Array(Schema.Struct({ position: Schema.Int }));

const DataRows = Schema.Array(Schema.Struct({ position: Schema.Int, data: Schema.fromJsonString(Schema.Unknown) }));

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

function headOf(position: number, stream: string, type: string, recorded: string): RecordHead {
  return { point: [String(position)], stream, type, recordedAt: `${recorded.replace(' ', 'T')}.000Z` };
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

function bounds({ order, after, from }: ExaminationScope): SQL {
  return SQL.concat(
    after === undefined
      ? SQL.EMPTY
      : SQL` AND global_position ${SQL.plain(order === 'asc' ? '>' : '<')} ${positionOf(after)}`,
    from === undefined ? SQL.EMPTY : SQL` AND global_position >= ${positionOf(from)}`,
  );
}

function ofTypes(column: string, types: readonly string[] | undefined): SQL {
  return types === undefined
    ? SQL`1`
    : SQL`${SQL.plain(column)} IN (SELECT value FROM json_each(${JSON.stringify(types)}))`;
}

function recordsWhere(where: SQL, scope: ExaminationScope): SQL {
  return SQL`SELECT global_position AS position, stream_id AS stream, message_type AS type, created AS recorded,
      ${ofTypes('message_type', scope.types)} AS wanted, octet_length(message_data) AS size
    FROM emt_messages
    WHERE ${where} AND partition = ${defaultPartition} AND is_archived = FALSE${bounds(scope)}
    ORDER BY global_position ${direction(scope)}
    LIMIT ${scope.examineAtMost + 1}`;
}

function recordsIn(streams: readonly string[] | undefined, scope: ExaminationScope): SQL {
  if (streams === undefined) {
    return recordsWhere(SQL`${brainKeyOfStream} = ${scope.brainKey}`, scope);
  }
  const ofEachStream = streams.map((stream) => SQL`SELECT * FROM (${recordsWhere(SQL`stream_id = ${stream}`, scope)})`);
  return SQL`${SQL.merge(ofEachStream, ' UNION ALL ')}
    ORDER BY position ${direction(scope)}
    LIMIT ${scope.examineAtMost + 1}`;
}

function examineRecords(execute: SQLExecutor): RecordedStatements['examineRecords'] {
  return async (streams, scope) => {
    const { rows } = await execute.query(
      SQL`SELECT position, stream, type, recorded, wanted, CASE WHEN wanted THEN size ELSE 0 END AS size, examined
        FROM (
          SELECT scanned.*, row_number() OVER (ORDER BY scanned.position ${direction(scope)}) AS examined
          FROM (${recordsIn(streams, scope)}) AS scanned
        )
        WHERE wanted OR examined >= ${scope.examineAtMost}
        ORDER BY examined
        LIMIT ${scope.answerAtMost}`,
    );
    return Schema.decodeUnknownSync(ExaminedRecordRows)(rows).map((row): ExaminedItem => {
      const head = headOf(row.position, row.stream, row.type, row.recorded);
      return { examined: row.examined, wanted: row.wanted === 1, size: row.size, point: head.point, heads: [head] };
    });
  };
}

function firstMessagesOfRuns(scope: ExaminationScope): SQL {
  return SQL`SELECT scanned.*, row_number() OVER (ORDER BY scanned.position ${direction(scope)}) AS examined
    FROM (
      SELECT global_position AS position, stream_id AS stream, message_type AS type, created AS recorded,
        octet_length(message_data) AS size
      FROM emt_messages
      WHERE ${kindKeyOfStream} = ${`${scope.brainKey}executions/`} AND stream_position = 1
        AND partition = ${defaultPartition} AND is_archived = FALSE${bounds(scope)}
      ORDER BY global_position ${direction(scope)}
      LIMIT ${scope.examineAtMost + 1}
    ) AS scanned`;
}

function examinedRunOf(row: typeof ExaminedRunRow.Type): ExaminedItem {
  const first = headOf(row.position, row.stream, row.type, row.recorded);
  const alone = row.latest_position === row.position;
  const wanted = row.wanted === 1;
  return {
    examined: row.examined,
    wanted,
    size: wanted ? row.size + (alone ? 0 : row.latest_size) : 0,
    point: first.point,
    heads: alone ? [first] : [first, headOf(row.latest_position, row.stream, row.latest_type, row.latest_recorded)],
  };
}

function examineRuns(execute: SQLExecutor): RecordedStatements['examineRuns'] {
  return async (scope) => {
    const wanted = ofTypes('latest.message_type', scope.types);
    const { rows } = await execute.query(
      SQL`SELECT f.position, f.stream, f.type, f.recorded, f.examined, f.size,
          latest.global_position AS latest_position, latest.message_type AS latest_type,
          latest.created AS latest_recorded, octet_length(latest.message_data) AS latest_size, ${wanted} AS wanted
        FROM (${firstMessagesOfRuns(scope)}) AS f
        JOIN emt_messages AS latest
          ON latest.stream_id = f.stream AND latest.partition = ${defaultPartition} AND latest.is_archived = FALSE
          AND latest.stream_position = (
            SELECT max(m.stream_position) FROM emt_messages AS m
            WHERE m.stream_id = f.stream AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
          )
        WHERE ${wanted} OR f.examined >= ${scope.examineAtMost}
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

export function sqliteRecordedStore(execute: SQLExecutor): RecordedStore {
  return {
    pointLength: 1,
    readRecorded: recordedReadingOver({
      firstPointSince: firstPointSince(execute),
      examineRecords: examineRecords(execute),
      examineRuns: examineRuns(execute),
      dataAt: dataAt(execute),
    }),
  };
}

const brainIndexes: readonly BrainIndex[] = [
  {
    name: 'ledger_messages_by_brain',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain ON emt_messages (${brainKeyOfStream}, global_position)`,
  },
  {
    name: 'ledger_messages_by_brain_and_time',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain_and_time ON emt_messages (${brainKeyOfStream}, created)`,
  },
  {
    name: 'ledger_messages_by_stream',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, global_position)`,
  },
  {
    name: 'ledger_first_messages_by_kind',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_first_messages_by_kind
      ON emt_messages (${kindKeyOfStream}, global_position) WHERE stream_position = 1`,
  },
];

export async function createSQLiteBrainIndexes(execute: IndexExecutor): Promise<void> {
  const names = JSON.stringify(brainIndexes.map(({ name }) => name));
  const { rows } = await execute.query(
    SQL`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT value FROM json_each(${names}))`,
  );
  const existing = new Set(Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name));
  await createMissingIndexes(execute, brainIndexes, existing);
}
