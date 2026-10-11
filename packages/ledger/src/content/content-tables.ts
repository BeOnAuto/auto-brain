import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { createMissingIndexes } from '../recorded/missing-indexes.ts';
import type { ContentDialect } from './content-dialects.ts';

export interface Shelf {
  readonly chunks: string;
  readonly heads: string;
  readonly keyColumns: readonly string[];
}

export const keptShelf: Shelf = {
  chunks: 'recorded_content_chunks',
  heads: 'recorded_content_heads',
  keyColumns: ['brain_key', 'sha256'],
};

export const stagingShelf: Shelf = {
  chunks: 'staged_content_chunks',
  heads: 'staged_content',
  keyColumns: ['brain_key', 'run_id', 'sha256'],
};

const shelves = [keptShelf, stagingShelf];

export interface ContentTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly create: (dialect: ContentDialect) => SQL;
}

function keyColumnsOf({ keyColumns }: Shelf): SQL {
  return SQL.merge(
    keyColumns.map((column) => SQL`${SQL.identifier(column)} TEXT NOT NULL`),
    ', ',
  );
}

function namesOf(columns: readonly string[]): SQL {
  return SQL.merge(
    columns.map((column) => SQL`${SQL.identifier(column)}`),
    ', ',
  );
}

function chunkTableOf(shelf: Shelf): ContentTable {
  const key = [...shelf.keyColumns, 'chunk'];
  return {
    name: shelf.chunks,
    columns: [...key, 'data'],
    create: ({ bytesType }) => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(shelf.chunks)} (
      ${keyColumnsOf(shelf)},
      chunk INTEGER NOT NULL,
      data ${SQL.plain(bytesType)} NOT NULL,
      PRIMARY KEY (${namesOf(key)})
    )`,
  };
}

function headTableOf(shelf: Shelf): ContentTable {
  return {
    name: shelf.heads,
    columns: [...shelf.keyColumns, 'bytes', 'chunks', 'media_type'],
    create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(shelf.heads)} (
      ${keyColumnsOf(shelf)},
      bytes BIGINT NOT NULL,
      chunks INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      PRIMARY KEY (${namesOf(shelf.keyColumns)})
    )`,
  };
}

export const contentTables: readonly ContentTable[] = shelves.flatMap((shelf) => [
  chunkTableOf(shelf),
  headTableOf(shelf),
]);

const contentTableNames: readonly string[] = contentTables.map(({ name }) => name);

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

async function namesFound(execute: StatementExecutor, sql: SQL): Promise<readonly string[]> {
  const { rows } = await execute.query(sql);
  return Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name);
}

function listed(columns: readonly string[]): string {
  return columns.toSorted().join(', ');
}

async function requireTheShapeKept(
  execute: StatementExecutor,
  dialect: ContentDialect,
  { name, columns }: ContentTable,
): Promise<void> {
  const found = await namesFound(execute, dialect.columnsOf(name));
  if (listed(found) !== listed(columns)) {
    throw new Error(
      `The ledger's database keeps recorded content in a shape this server no longer reads: ${name} has the columns ${listed(found)}, where this server keeps ${listed(columns)}. Nothing stored before launch is carried over, so delete the local database and start the server again`,
    );
  }
}

export async function createdContentTables(execute: StatementExecutor, dialect: ContentDialect): Promise<void> {
  const existing = new Set(await namesFound(execute, dialect.tablesAmong(contentTableNames)));
  await inTurn(
    contentTables.filter(({ name }) => existing.has(name)),
    (table) => requireTheShapeKept(execute, dialect, table),
  );
  await createMissingIndexes(
    execute,
    contentTables.map((table) => ({ name: table.name, create: () => table.create(dialect) })),
    existing,
  );
}
