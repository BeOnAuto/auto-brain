import type { RecordedContent } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';

import { contentTableNames, createdContentTables, recordedContentOn } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createPostgreSQLBrainIndexes } from '../postgresql-reads/brain-indexes.ts';
import type { Query } from '../postgresql-reads/recorded-parts.ts';

const existingContentTables = SQL`SELECT relname AS name FROM pg_class
  WHERE relkind IN ('r', 'p') AND relname IN (${SQL.merge(
    contentTableNames.map((name) => SQL`${name}`),
    ', ',
  )}) AND pg_table_is_visible(oid)`;

export async function postgresqlSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createPostgreSQLBrainIndexes({ execute });
  await createdContentTables(execute, existingContentTables);
}

export function postgresqlContentOn(query: Query): RecordedContent {
  const formatted = (sql: SQL): Promise<readonly unknown[]> => {
    const { query: text, params } = SQL.format(sql, pgFormatter);
    return query(text, params);
  };
  return recordedContentOn({ query: async (sql) => ({ rows: await formatted(sql) }), command: formatted });
}
