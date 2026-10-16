import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { ContentDialect } from '../content/content-dialects.ts';
import type { StatementExecutor } from '../event-store.ts';
import { createMissingIndexes, type PlaybookIndex } from '../recorded/missing-indexes.ts';

export const sealedSecrets = SQL.identifier('sealed_secrets');

const sealedSecretsTable: PlaybookIndex = {
  name: 'sealed_secrets',
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${sealedSecrets} (
    id TEXT PRIMARY KEY,
    kid TEXT NOT NULL,
    sealed TEXT NOT NULL,
    kept_at TEXT NOT NULL
  )`,
};

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

export async function createdSecretTable(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const { rows } = await execute.query(dialect.relationsAmong('table', [sealedSecretsTable.name]));
  const existing = new Set(Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name));
  await createMissingIndexes(execute, [sealedSecretsTable], existing);
}
