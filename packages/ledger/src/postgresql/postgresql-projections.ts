import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import { projectionPartsOf, type KeptTables } from '../projections/projection-parts.ts';
import type { ReadQuery } from '../projections/projection-reads.ts';
import { createPostgreSQLBrainIndexes } from './brain-indexes.ts';
import { dataAsJsonText } from './json-text.ts';
import type { Query } from './recorded-parts.ts';

const defaultPartition = 'emt:default';

const rowsInAWrite = 500;

const decodeJsonText = Schema.decodeUnknownSync(Schema.Struct({ json: Schema.String }));

function storedData(stored: unknown): unknown {
  return dataAsJsonText.read(decodeJsonText(stored));
}

export const postgresqlProjectionDialect: ProjectionDialect = {
  tableVersions: (name) => SQL`SELECT relname AS name FROM pg_class
    WHERE relkind IN ('r', 'p') AND relname ~ ${`^${name}_[0-9]+$`} AND pg_table_is_visible(oid)`,
  columnTypes: { text: 'text', integer: 'bigint', boolean: 'boolean' },
  asNumber: (expression) => `${expression}::float8`,
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
    SQL`SELECT stream_id AS stream, message_type AS type, message_data AS data, stream_position::float8 AS position
      FROM emt_messages
      WHERE stream_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(streams)}::jsonb))
        AND message_type IN (SELECT jsonb_array_elements_text(${JSON.stringify(types)}::jsonb))
        AND partition = ${defaultPartition} AND is_archived = FALSE
      ORDER BY stream_id, stream_position`,
  rowsInAWrite: () => rowsInAWrite,
  filledData: storedData,
  appendedData: storedData,
  booleanOf: (value) => value,
};

export function formattedFor(query: Query): ReadQuery {
  return (sql) => {
    const { query: text, params } = SQL.format(sql, pgFormatter);
    return query(text, params);
  };
}

export function postgresqlProjectionsOf(kept: KeptTables) {
  const parts = projectionPartsOf(postgresqlProjectionDialect, kept);
  return {
    ...parts,
    afterTheSchema: async ({ execute }: { readonly execute: StatementExecutor }): Promise<void> => {
      await createPostgreSQLBrainIndexes({ execute });
      await parts.prepare(execute, (work) => work(execute));
    },
  };
}
