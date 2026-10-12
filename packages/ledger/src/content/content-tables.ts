import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { createMissingIndexes } from '../recorded/missing-indexes.ts';
import type { ContentDialect } from './content-dialects.ts';

export interface Shelf {
  readonly chunks: string;
  readonly heads: string;
  readonly placeColumns: readonly string[];
}

export const keptShelf: Shelf = {
  chunks: 'recorded_content_chunks',
  heads: 'recorded_content_heads',
  placeColumns: ['brain_key'],
};

export const stagingShelf: Shelf = {
  chunks: 'staged_content_chunks',
  heads: 'staged_content',
  placeColumns: ['brain_key', 'run_id'],
};

export const unstagedRuns = 'unstaged_runs';

export interface ContentTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly create: (dialect: ContentDialect) => SQL;
}

function textColumns(columns: readonly string[]): SQL {
  return SQL.merge(
    columns.map((column) => SQL`${SQL.identifier(column)} TEXT NOT NULL`),
    ', ',
  );
}

function namesOf(columns: readonly string[]): SQL {
  return SQL.merge(
    columns.map((column) => SQL`${SQL.identifier(column)}`),
    ', ',
  );
}

function chunkTableOf({ chunks, placeColumns }: Shelf): ContentTable {
  const key = [...placeColumns, 'upload_id', 'chunk'];
  return {
    name: chunks,
    columns: [...key, 'data'],
    create: ({ bytesType }) => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(chunks)} (
      ${textColumns([...placeColumns, 'upload_id'])},
      chunk INTEGER NOT NULL,
      data ${SQL.plain(bytesType)} NOT NULL,
      PRIMARY KEY (${namesOf(key)})
    )`,
  };
}

function headTableOf({ heads, placeColumns }: Shelf): ContentTable {
  const key = [...placeColumns, 'sha256'];
  return {
    name: heads,
    columns: [...key, 'upload_id', 'bytes', 'chunks', 'media_type'],
    create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(heads)} (
      ${textColumns([...key, 'upload_id'])},
      bytes BIGINT NOT NULL,
      chunks INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      PRIMARY KEY (${namesOf(key)})
    )`,
  };
}

const unstagedRunsTable: ContentTable = {
  name: unstagedRuns,
  columns: stagingShelf.placeColumns,
  create: () => SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(unstagedRuns)} (
    ${textColumns(stagingShelf.placeColumns)},
    PRIMARY KEY (${namesOf(stagingShelf.placeColumns)})
  )`,
};

export const contentTables: readonly ContentTable[] = [
  ...[keptShelf, stagingShelf].flatMap((shelf) => [chunkTableOf(shelf), headTableOf(shelf)]),
  unstagedRunsTable,
];

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
