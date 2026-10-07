import {
  projectedTableOf,
  type ProjectedIndex,
  type ProjectedRow,
  type RunProjection,
  type RunStream,
} from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';
import { boundOf, selectedColumn, valueOf, type ProjectionDialect } from './projection-dialect.ts';

export interface ProjectedRunRowOf {
  readonly run: RunStream;
  readonly row: ProjectedRow;
}

const keyColumns = ['brain_key', 'run_id'] as const;

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const StreamRows = Schema.Array(Schema.Struct({ stream: Schema.String, size: Schema.Number }));

const MessageRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, type: Schema.String, data: Schema.Unknown, position: Schema.Number }),
);

const decodeObjects = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)));

export function tableOf(projection: RunProjection): SQL {
  return SQL`${SQL.plain(projectedTableOf(projection))}`;
}

function indexStatement(projection: RunProjection, index: ProjectedIndex): SQL {
  const table = projectedTableOf(projection);
  const columns = [...(index.acrossBrains === true ? [] : ['brain_key']), ...index.columns].join(', ');
  const where = index.whereSet === undefined ? '' : ` WHERE ${index.whereSet} IS NOT NULL`;
  return SQL`CREATE INDEX IF NOT EXISTS ${SQL.plain(`${table}_${index.name}`)} ON ${tableOf(projection)} (${SQL.plain(columns)})${SQL.plain(where)}`;
}

export function createdTable(dialect: ProjectionDialect, projection: RunProjection): readonly SQL[] {
  const columns = projection.columns.map(({ name, kind }) => `${name} ${dialect.columnTypes[kind]}`).join(',\n      ');
  const key = `${dialect.columnTypes.text} NOT NULL`;
  return [
    SQL`CREATE TABLE IF NOT EXISTS ${tableOf(projection)} (
      brain_key ${SQL.plain(key)},
      run_id ${SQL.plain(key)},
      ${SQL.plain(columns)},
      PRIMARY KEY (brain_key, run_id)
    )`,
    ...projection.indexes.map((index) => indexStatement(projection, index)),
  ];
}

export function selectedColumns(dialect: ProjectionDialect, projection: RunProjection): SQL {
  return SQL`${SQL.plain(projection.columns.map((column) => selectedColumn(dialect, column)).join(', '))}`;
}

export function rowFrom(projection: RunProjection, stored: Readonly<Record<string, unknown>>): ProjectedRow {
  return Object.fromEntries(projection.columns.map((column) => [column.name, valueOf(column, stored[column.name])]));
}

export function rowsFrom(rows: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] {
  return decodeObjects(rows);
}

export async function rowIn(
  execute: StatementExecutor,
  dialect: ProjectionDialect,
  projection: RunProjection,
  { brainKey, runId }: RunStream,
): Promise<ProjectedRow | undefined> {
  const { rows } = await execute.query(
    SQL`SELECT ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)} WHERE brain_key = ${brainKey} AND run_id = ${runId}`,
  );
  const [stored] = rowsFrom(rows);
  return stored === undefined ? undefined : rowFrom(projection, stored);
}

function valuesOf(dialect: ProjectionDialect, projection: RunProjection, { run, row }: ProjectedRunRowOf): SQL {
  const values = projection.columns.map(({ name }) => SQL`${boundOf(dialect, row[name] ?? null)}`);
  return SQL`(${SQL.merge([SQL`${run.brainKey}`, SQL`${run.runId}`, ...values], ', ')})`;
}

export function rowsWrite(
  dialect: ProjectionDialect,
  projection: RunProjection,
  kept: readonly ProjectedRunRowOf[],
): SQL {
  const names = projection.columns.map(({ name }) => name);
  const columns = SQL.plain([...keyColumns, ...names].join(', '));
  const updates = SQL.plain(names.map((name) => `${name} = excluded.${name}`).join(', '));
  const values = SQL.merge(
    kept.map((each) => valuesOf(dialect, projection, each)),
    ', ',
  );
  return SQL`INSERT INTO ${tableOf(projection)} (${columns})
    VALUES ${values}
    ON CONFLICT (brain_key, run_id) DO UPDATE SET ${updates}`;
}

export function tableDrop(name: string): SQL {
  return SQL`DROP TABLE IF EXISTS ${SQL.plain(name)}`;
}

export function tableAnalysis(projection: RunProjection): SQL {
  return SQL`ANALYZE ${tableOf(projection)}`;
}

export async function namesIn(execute: StatementExecutor, query: SQL): Promise<readonly string[]> {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name);
}

export interface SizedStream {
  readonly stream: string;
  readonly size: number;
}

export async function streamsIn(execute: StatementExecutor, query: SQL): Promise<readonly SizedStream[]> {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(StreamRows)(rows);
}

export async function messagesIn(execute: StatementExecutor, query: SQL) {
  const { rows } = await execute.query(query);
  return Schema.decodeUnknownSync(MessageRows)(rows);
}
