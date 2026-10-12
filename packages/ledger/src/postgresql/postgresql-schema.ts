import { postgresqlContent } from '../content/content-dialects.ts';
import { createdContentTables } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createPostgreSQLBrainIndexes } from '../postgresql-reads/brain-indexes.ts';

export async function postgresqlSchemaCreated(execute: StatementExecutor): Promise<void> {
  await createPostgreSQLBrainIndexes({ execute });
  await createdContentTables(execute, postgresqlContent);
}
