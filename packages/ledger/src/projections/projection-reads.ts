import {
  requireAdvancedColumns,
  rowKeyColumn,
  streamPrefixOfBrain,
  type DueRowsQuery,
  type KeyedProjection,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRowsQuery,
  type ProjectedValue,
  type ProjectionAdvancer,
  type ProjectionReader,
} from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Effect, Schema } from 'effect';

import { boundOf, type ProjectionDialect } from './projection-dialect.ts';
import { rowAdvance, rowFrom, rowsFrom, selectedColumns, tableOf } from './projection-statements.ts';

export type ReadQuery = (sql: SQL) => Promise<readonly unknown[]>;

type WriteCommand = (sql: SQL) => Promise<unknown>;

export interface ProjectionStatements {
  readonly query: ReadQuery;
  readonly command: WriteCommand;
}

const brainKey = /^brain\/(?<org>[^/]+)\/(?<brain>[^/]+)\/$/u;

const KeyFields = Schema.Struct({ brain_key: Schema.String, row_key: Schema.String });

const decodeKey = Schema.decodeUnknownSync(KeyFields);

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

const DueRows = Schema.Tuple([Schema.Struct({ due: Schema.NullOr(Schema.Number) })]);

interface Reading {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly KeyedProjection[];
  readonly query: ReadQuery;
}

function columnOf(projection: KeyedProjection, name: string): string {
  if (name !== rowKeyColumn && !projection.columns.some((column) => column.name === name)) {
    throw new Error(`The projection ${projection.name} has no column ${name}`);
  }
  return name;
}

function conditionsOf(dialect: ProjectionDialect, projection: KeyedProjection, where: readonly ProjectedCondition[]) {
  return SQL.merge(
    where.map(
      ({ column, equals }) => SQL` AND ${SQL.plain(columnOf(projection, column))} = ${boundOf(dialect, equals)}`,
    ),
    '',
  );
}

function afterOf(dialect: ProjectionDialect, projection: KeyedProjection, query: ProjectedRowsQuery): SQL {
  const { after, orderBy, order } = query;
  if (after === undefined) {
    return SQL.EMPTY;
  }
  const columns = [...orderBy.map((column) => columnOf(projection, column)), rowKeyColumn].join(', ');
  const values = SQL.merge(
    after.map((value: ProjectedValue) => SQL`${boundOf(dialect, value)}`),
    ', ',
  );
  return SQL` AND (${SQL.plain(columns)}) ${SQL.plain(order === 'asc' ? '>' : '<')} (${values})`;
}

function orderOf(projection: KeyedProjection, { orderBy, order }: ProjectedRowsQuery): SQL {
  const direction = order === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST';
  const ordered = [...orderBy.map((column) => columnOf(projection, column)), rowKeyColumn]
    .map((column) => `${column} ${direction}`)
    .join(', ');
  return SQL`${SQL.plain(ordered)}`;
}

function keyedRowOf(projection: KeyedProjection, stored: Readonly<Record<string, unknown>>): ProjectedKeyedRow {
  const { brain_key: prefix, row_key: key } = decodeKey(stored);
  const groups = brainKey.exec(prefix)?.groups;
  return { org: String(groups?.['org']), brain: String(groups?.['brain']), key, row: rowFrom(projection, stored) };
}

function projectionNamed(projections: readonly KeyedProjection[], name: string): KeyedProjection | undefined {
  return projections.find((projection) => projection.name === name);
}

async function rowsRead(
  { dialect, query }: Reading,
  projection: KeyedProjection,
  filter: SQL,
  ordered: SQL,
): Promise<readonly ProjectedKeyedRow[]> {
  const rows = await query(
    SQL`SELECT brain_key, row_key, ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)} WHERE ${filter} ORDER BY ${ordered}`,
  );
  return rowsFrom(rows).map((stored) => keyedRowOf(projection, stored));
}

function brainRows(reading: Reading, projection: KeyedProjection, brain: string, query: ProjectedRowsQuery) {
  const { dialect } = reading;
  const filter = SQL`brain_key = ${brain}${conditionsOf(dialect, projection, query.where)}${afterOf(dialect, projection, query)}`;
  return rowsRead(reading, projection, filter, SQL`${orderOf(projection, query)} LIMIT ${query.limit}`);
}

function dueRows(reading: Reading, projection: KeyedProjection, { column, through, limit }: DueRowsQuery) {
  const due = columnOf(projection, column);
  return rowsRead(
    reading,
    projection,
    SQL`${SQL.plain(due)} IS NOT NULL AND ${SQL.plain(due)} <= ${through}`,
    SQL`${SQL.plain(due)}, brain_key, row_key LIMIT ${limit}`,
  );
}

async function counted(
  reading: Reading,
  projection: KeyedProjection,
  brain: string,
  where: readonly ProjectedCondition[],
) {
  const rows = await reading.query(
    SQL`SELECT CAST(count(*) AS INTEGER) AS count FROM ${tableOf(projection)} WHERE brain_key = ${brain}${conditionsOf(reading.dialect, projection, where)}`,
  );
  return Schema.decodeUnknownSync(CountRows)(rows).reduce((total, { count }) => total + count, 0);
}

async function soonest(
  reading: Reading,
  projection: KeyedProjection,
  column: string,
  after: number,
): Promise<number | null> {
  const named = columnOf(projection, column);
  const rows = await reading.query(
    SQL`SELECT ${SQL.plain(reading.dialect.asNumber(`min(${named})`))} AS due FROM ${tableOf(projection)} WHERE ${SQL.plain(named)} IS NOT NULL AND ${SQL.plain(named)} > ${after}`,
  );
  const [{ due }] = Schema.decodeUnknownSync(DueRows)(rows);
  return due;
}

export function projectionReader(
  dialect: ProjectionDialect,
  projections: readonly KeyedProjection[],
  { query, command }: ProjectionStatements,
): ProjectionReader & ProjectionAdvancer {
  const reading = { dialect, projections, query };
  const withProjection = <A>(name: string, none: A, read: (projection: KeyedProjection) => Promise<A>) =>
    Effect.promise(() => {
      const projection = projectionNamed(projections, name);
      return projection === undefined ? Promise.resolve(none) : read(projection);
    });
  return {
    readProjectedRows: (name, brain, rowsQuery) =>
      withProjection(name, [], (projection) => brainRows(reading, projection, streamPrefixOfBrain(brain), rowsQuery)),
    countProjectedRows: (name, brain, where) =>
      withProjection(name, 0, (projection) => counted(reading, projection, streamPrefixOfBrain(brain), where)),
    readDueRows: (name, dueQuery) => withProjection(name, [], (projection) => dueRows(reading, projection, dueQuery)),
    nextDueOf: (name, column, after) =>
      withProjection(name, null, (projection) => soonest(reading, projection, column, after)),
    advanceRow: (name, brain, key, columns) =>
      Effect.promise(async () => {
        const projection = projectionNamed(projections, name);
        if (projection !== undefined) {
          requireAdvancedColumns(projection, columns);
          await command(rowAdvance(dialect, projection, { brainKey: streamPrefixOfBrain(brain), key }, columns));
        }
      }),
  };
}
