import {
  streamPrefixOfBrain,
  type DueRowsQuery,
  type ProjectedCondition,
  type ProjectedRowsQuery,
  type ProjectedRunRow,
  type ProjectedValue,
  type ProjectionReader,
  type RunProjection,
} from '@beonauto/operations';
import { SQL } from '@event-driven-io/dumbo';
import { Effect, Schema } from 'effect';

import { boundOf, type ProjectionDialect } from './projection-dialect.ts';
import { rowFrom, rowsFrom, selectedColumns, tableOf } from './projection-statements.ts';

export type ReadQuery = (sql: SQL) => Promise<readonly unknown[]>;

const brainKey = /^brain\/(?<org>[^/]+)\/(?<brain>[^/]+)\/$/u;

const KeyFields = Schema.Struct({ brain_key: Schema.String, run_id: Schema.String });

const decodeKey = Schema.decodeUnknownSync(KeyFields);

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

const DueRows = Schema.Tuple([Schema.Struct({ due: Schema.NullOr(Schema.Number) })]);

interface Reading {
  readonly dialect: ProjectionDialect;
  readonly projections: readonly RunProjection[];
  readonly query: ReadQuery;
}

function columnOf(projection: RunProjection, name: string): string {
  if (name !== 'run_id' && !projection.columns.some((column) => column.name === name)) {
    throw new Error(`The projection ${projection.name} has no column ${name}`);
  }
  return name;
}

function conditionsOf(dialect: ProjectionDialect, projection: RunProjection, where: readonly ProjectedCondition[]) {
  return SQL.merge(
    where.map(
      ({ column, equals }) => SQL` AND ${SQL.plain(columnOf(projection, column))} = ${boundOf(dialect, equals)}`,
    ),
    '',
  );
}

function afterOf(dialect: ProjectionDialect, projection: RunProjection, query: ProjectedRowsQuery): SQL {
  const { after, orderBy, order } = query;
  if (after === undefined) {
    return SQL.EMPTY;
  }
  const columns = [...orderBy.map((column) => columnOf(projection, column)), 'run_id'].join(', ');
  const values = SQL.merge(
    after.map((value: ProjectedValue) => SQL`${boundOf(dialect, value)}`),
    ', ',
  );
  return SQL` AND (${SQL.plain(columns)}) ${SQL.plain(order === 'asc' ? '>' : '<')} (${values})`;
}

function orderOf(projection: RunProjection, { orderBy, order }: ProjectedRowsQuery): SQL {
  const direction = order === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST';
  const ordered = [...orderBy.map((column) => columnOf(projection, column)), 'run_id']
    .map((column) => `${column} ${direction}`)
    .join(', ');
  return SQL`${SQL.plain(ordered)}`;
}

function runRowOf(projection: RunProjection, stored: Readonly<Record<string, unknown>>): ProjectedRunRow {
  const { brain_key: key, run_id: runId } = decodeKey(stored);
  const groups = brainKey.exec(key)?.groups;
  return { org: String(groups?.['org']), brain: String(groups?.['brain']), runId, row: rowFrom(projection, stored) };
}

function projectionNamed(projections: readonly RunProjection[], name: string): RunProjection | undefined {
  return projections.find((projection) => projection.name === name);
}

async function rowsRead(
  { dialect, query }: Reading,
  projection: RunProjection,
  filter: SQL,
  ordered: SQL,
): Promise<readonly ProjectedRunRow[]> {
  const rows = await query(
    SQL`SELECT brain_key, run_id, ${selectedColumns(dialect, projection)} FROM ${tableOf(projection)} WHERE ${filter} ORDER BY ${ordered}`,
  );
  return rowsFrom(rows).map((stored) => runRowOf(projection, stored));
}

function brainRows(reading: Reading, projection: RunProjection, brain: string, query: ProjectedRowsQuery) {
  const { dialect } = reading;
  const filter = SQL`brain_key = ${brain}${conditionsOf(dialect, projection, query.where)}${afterOf(dialect, projection, query)}`;
  return rowsRead(reading, projection, filter, SQL`${orderOf(projection, query)} LIMIT ${query.limit}`);
}

function dueRows(reading: Reading, projection: RunProjection, { column, through, limit }: DueRowsQuery) {
  const due = columnOf(projection, column);
  return rowsRead(
    reading,
    projection,
    SQL`${SQL.plain(due)} IS NOT NULL AND ${SQL.plain(due)} <= ${through}`,
    SQL`${SQL.plain(due)}, brain_key, run_id LIMIT ${limit}`,
  );
}

async function counted(
  reading: Reading,
  projection: RunProjection,
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
  projection: RunProjection,
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
  projections: readonly RunProjection[],
  query: ReadQuery,
): ProjectionReader {
  const reading = { dialect, projections, query };
  const withProjection = <A>(name: string, none: A, read: (projection: RunProjection) => Promise<A>) =>
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
  };
}
