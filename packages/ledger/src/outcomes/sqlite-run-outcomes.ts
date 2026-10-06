import type { RunOutcomeMapping, RunOutcomeSelection } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { RunOutcomesStore, StatementExecutor } from '../event-store.ts';
import { runOutcomeRegistrations, type RunOutcomeKeeping } from './run-outcome-projection.ts';
import {
  groupFields,
  groupOf,
  runOutcomesIndex,
  runOutcomesTable,
  type RunOutcomeStatements,
} from './run-outcome-statements.ts';
import { preparedRunOutcomes } from './run-outcome-table.ts';

const table = SQL.plain(runOutcomesTable);

const defaultPartition = 'emt:default';

const decodeText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const GroupRows = Schema.Array(
  Schema.Struct({ ...groupFields, durations: Schema.fromJsonString(Schema.Array(Schema.Number)) }),
);

const sqliteRunOutcomeStatements: RunOutcomeStatements = {
  tableVersions: () => SQL`SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'run_outcomes_*'`,
  create: () => [
    SQL`CREATE TABLE IF NOT EXISTS ${table} (
      brain_key TEXT NOT NULL,
      run_id TEXT NOT NULL,
      started_day TEXT,
      started_at TEXT,
      last_started_at TEXT,
      primitive TEXT,
      name TEXT,
      status TEXT,
      duration_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      PRIMARY KEY (brain_key, run_id)
    )`,
    SQL`CREATE INDEX IF NOT EXISTS ${SQL.plain(runOutcomesIndex)} ON ${table} (brain_key, started_day)`,
  ],
  runStreamsAfter: (after, count, types) =>
    SQL`SELECT s.stream_id AS stream, (
        SELECT coalesce(sum(octet_length(m.message_data)), 0) FROM emt_messages AS m
        WHERE m.stream_id = s.stream_id AND m.message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))
          AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ) AS size
      FROM emt_streams AS s
      WHERE s.stream_id > ${after} AND s.stream_id GLOB '*/*/*/executions/*'
        AND s.partition = ${defaultPartition} AND s.is_archived = FALSE
      ORDER BY s.stream_id
      LIMIT ${count}`,
  messagesOf: (streams, types) =>
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data FROM emt_messages
      WHERE stream_id IN (SELECT value FROM json_each(${JSON.stringify(streams)}))
        AND message_type IN (SELECT value FROM json_each(${JSON.stringify(types)}))
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_id, stream_position`,
  rowsInAWrite: 8,
  filledData: (column) => decodeText(column),
  appendedData: (stored) => stored,
  rowOf: ({ brainKey, runId }) =>
    SQL`SELECT started_day, started_at, last_started_at, primitive, name, status, duration_ms, input_tokens,
        output_tokens, cached_tokens
      FROM ${table} WHERE brain_key = ${brainKey} AND run_id = ${runId}`,
  afterFill: () => [SQL`ANALYZE ${table}`],
};

function selected({ primitive, name }: RunOutcomeSelection): SQL {
  return SQL.concat(
    primitive === undefined ? SQL.EMPTY : SQL` AND primitive = ${primitive}`,
    name === undefined ? SQL.EMPTY : SQL` AND name = ${name}`,
  );
}

export function sqliteRunOutcomesReader(execute: StatementExecutor): RunOutcomesStore['readRunOutcomes'] {
  return async (brainKey, { from, to }, selection) => {
    const { rows } = await execute.query(
      SQL`SELECT started_day AS day, primitive, name, status, count(*) AS runs,
          coalesce(sum(input_tokens), 0) AS input_tokens, coalesce(sum(output_tokens), 0) AS output_tokens,
          coalesce(sum(cached_tokens), 0) AS cached_tokens,
          json_group_array(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS durations
        FROM ${table}
        WHERE brain_key = ${brainKey} AND started_day BETWEEN ${from} AND ${to}${selected(selection)}
        GROUP BY started_day, primitive, name, status`,
    );
    return Schema.decodeUnknownSync(GroupRows)(rows).map((row) => groupOf(row));
  };
}

function keepingBy(mapping: RunOutcomeMapping): RunOutcomeKeeping {
  return { statements: sqliteRunOutcomeStatements, mapping };
}

export function sqliteRunOutcomeProjections(mapping: RunOutcomeMapping | undefined) {
  return runOutcomeRegistrations(sqliteRunOutcomeStatements, mapping);
}

interface Transaction {
  readonly execute: StatementExecutor;
}

export interface TransactionalPool extends Transaction {
  readonly withTransaction: (handle: (transaction: Transaction) => Promise<void>) => Promise<void>;
}

export async function prepareSQLiteRunOutcomes(
  pool: TransactionalPool,
  mapping: RunOutcomeMapping | undefined,
): Promise<void> {
  if (mapping !== undefined) {
    await preparedRunOutcomes(keepingBy(mapping), pool.execute, (work) =>
      pool.withTransaction(({ execute }) => work(execute)),
    );
  }
}
