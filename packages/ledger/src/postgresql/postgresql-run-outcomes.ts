import type { RunOutcomeMapping, RunOutcomeSelection } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { RunOutcomesStore, StatementExecutor } from '../event-store.ts';
import { runOutcomeRegistrations, type RunOutcomeKeeping } from '../outcomes/run-outcome-projection.ts';
import {
  groupFields,
  groupOf,
  runOutcomesIndex,
  runOutcomesTable,
  type RunOutcomeStatements,
} from '../outcomes/run-outcome-statements.ts';
import { preparedRunOutcomes } from '../outcomes/run-outcome-table.ts';
import { createPostgreSQLBrainIndexes } from './brain-indexes.ts';
import { dataAsJsonText } from './json-text.ts';
import { binding, type Bind, type Query } from './postgresql-recorded.ts';

const table = SQL.plain(runOutcomesTable);

const defaultPartition = 'emt:default';

const decodeJsonText = Schema.decodeUnknownSync(Schema.Struct({ json: Schema.String }));

const GroupRows = Schema.Array(Schema.Struct({ ...groupFields, durations: Schema.Array(Schema.Number) }));

function storedData(stored: unknown): unknown {
  return dataAsJsonText.read(decodeJsonText(stored));
}

const postgresqlRunOutcomeStatements: RunOutcomeStatements = {
  tableVersions: () => SQL`SELECT relname AS name FROM pg_class
    WHERE relkind IN ('r', 'p') AND relname ~ '^run_outcomes_[0-9]+$' AND pg_table_is_visible(oid)`,
  create: () => [
    SQL`CREATE TABLE IF NOT EXISTS ${table} (
      brain_key text NOT NULL,
      run_id text NOT NULL,
      started_day text,
      started_at text,
      last_started_at text,
      primitive text,
      name text,
      status text,
      duration_ms bigint,
      input_tokens bigint,
      output_tokens bigint,
      cached_tokens bigint,
      PRIMARY KEY (brain_key, run_id)
    )`,
    SQL`CREATE INDEX IF NOT EXISTS ${SQL.plain(runOutcomesIndex)} ON ${table} (brain_key, started_day)`,
  ],
  runStreamsAfter: (after, count, types) =>
    SQL`SELECT s.stream_id AS stream, (
        SELECT coalesce(sum(octet_length(m.message_data ->> 'json')), 0)::float8 FROM emt_messages AS m
        WHERE m.stream_id = s.stream_id
          AND m.message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))
          AND m.partition = ${defaultPartition} AND m.is_archived = FALSE
      ) AS size
      FROM emt_streams AS s
      WHERE s.stream_id > ${after} AND s.stream_id ~ '^[^/]+/[^/]+/[^/]+/executions/[^/]+$'
        AND s.partition = ${defaultPartition} AND s.is_archived = FALSE
      ORDER BY s.stream_id
      LIMIT ${count}`,
  messagesOf: (streams, types) =>
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data FROM emt_messages
      WHERE stream_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(streams)}::jsonb))
        AND message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_id, stream_position`,
  rowsInAWrite: 500,
  filledData: storedData,
  appendedData: storedData,
  rowOf: ({ brainKey, runId }) =>
    SQL`SELECT started_day, started_at, last_started_at, primitive, name, status, duration_ms::float8 AS duration_ms,
        input_tokens::float8 AS input_tokens, output_tokens::float8 AS output_tokens,
        cached_tokens::float8 AS cached_tokens
      FROM ${table} WHERE brain_key = ${brainKey} AND run_id = ${runId}`,
  afterFill: () => [SQL`ANALYZE ${table}`],
};

function selected(bind: Bind, { primitive, name }: RunOutcomeSelection): string {
  const ofPrimitive = primitive === undefined ? '' : ` AND primitive = ${bind(primitive)}`;
  return name === undefined ? ofPrimitive : `${ofPrimitive} AND name = ${bind(name)}`;
}

export function postgresqlRunOutcomesReader(query: Query): RunOutcomesStore['readRunOutcomes'] {
  return async (brainKey, { from, to }, selection) => {
    const { values, bind } = binding();
    const rows = await query(
      `SELECT started_day AS day, primitive, name, status, count(*)::int AS runs,
          coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
          coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
          coalesce(sum(cached_tokens), 0)::float8 AS cached_tokens,
          coalesce(json_agg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), '[]'::json) AS durations
        FROM ${runOutcomesTable}
        WHERE brain_key = ${bind(brainKey)} AND started_day BETWEEN ${bind(from)} AND ${bind(to)}${selected(bind, selection)}
        GROUP BY started_day, primitive, name, status`,
      values,
    );
    return Schema.decodeUnknownSync(GroupRows)(rows).map((row) => groupOf(row));
  };
}

function keepingBy(mapping: RunOutcomeMapping): RunOutcomeKeeping {
  return { statements: postgresqlRunOutcomeStatements, mapping };
}

export function postgresqlRunOutcomeProjections(mapping?: RunOutcomeMapping) {
  return runOutcomeRegistrations(postgresqlRunOutcomeStatements, mapping);
}

export function afterTheSchemaWithin(
  mapping?: RunOutcomeMapping,
): (migration: { readonly execute: StatementExecutor }) => Promise<void> {
  return async ({ execute }) => {
    await createPostgreSQLBrainIndexes({ execute });
    if (mapping !== undefined) {
      await preparedRunOutcomes(keepingBy(mapping), execute, (work) => work(execute));
    }
  };
}
