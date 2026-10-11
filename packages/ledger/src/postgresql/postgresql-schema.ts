import type { RecordedContent } from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';

import { postgresqlContent } from '../content/content-dialects.ts';
import { recordedContentOn } from '../content/content-store.ts';
import { createdContentTables } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createPostgreSQLBrainIndexes } from '../postgresql-reads/brain-indexes.ts';
import type { Query } from '../postgresql-reads/recorded-parts.ts';

export async function postgresqlSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createPostgreSQLBrainIndexes({ execute });
  await createdContentTables(execute, postgresqlContent);
}

export function postgresqlContentOn(query: Query): RecordedContent {
  const formatted = (sql: SQL): Promise<readonly unknown[]> => {
    const { query: text, params } = SQL.format(sql, pgFormatter);
    return query(text, params);
  };
  return recordedContentOn(
    { query: async (sql) => ({ rows: await formatted(sql) }), command: formatted },
    postgresqlContent,
  );
}
