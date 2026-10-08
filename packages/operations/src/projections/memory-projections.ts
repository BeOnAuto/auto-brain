import { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import { streamPrefixOfBrain } from '../ledger/bound-ports.ts';
import type { TypedEvent } from '../ledger/decider.ts';
import { messageIdOf } from '../ledger/message-lineage.ts';
import {
  brainStreamOf,
  checkedProjection,
  requireAdvancedColumns,
  rowKeyColumn,
  rowKeyOf,
  type BrainStream,
  type DueRowsQuery,
  type KeyedProjection,
  type ProjectedCondition,
  type ProjectedKeyedRow,
  type ProjectedRow,
  type ProjectedRowsQuery,
  type ProjectedValue,
  type ProjectionAdvancer,
  type ProjectionReader,
  type RowAdvance,
} from './keyed-projection.ts';

export interface MemoryProjections extends ProjectionReader, ProjectionAdvancer {
  readonly project: (
    stream: string,
    events: readonly TypedEvent[],
    encoded: readonly unknown[],
    firstPosition: number,
  ) => void;
}

interface Table {
  readonly projection: KeyedProjection;
  readonly rows: Map<string, ProjectedKeyedRow>;
}

interface Fact {
  readonly type: string;
  readonly data: unknown;
  readonly position: number;
}

const brainKey = /^brain\/(?<org>[^/]+)\/(?<brain>[^/]+)\/$/u;

const nothingKept: ReadonlyMap<string, ProjectedKeyedRow> = new Map();

function keyedRowOf(prefix: string, key: string, row: ProjectedRow): ProjectedKeyedRow {
  const groups = brainKey.exec(prefix)?.groups;
  return { org: String(groups?.['org']), brain: String(groups?.['brain']), key, row };
}

type Ordered = ProjectedValue | undefined;

function rankOf(value: Ordered): string | number | boolean {
  return value ?? Number.NEGATIVE_INFINITY;
}

function compared(left: Ordered, right: Ordered): number {
  const first = rankOf(left);
  const second = rankOf(right);
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

function tupleCompared(left: readonly Ordered[], right: readonly Ordered[]): number {
  for (const [index, value] of left.entries()) {
    const order = compared(value, right[index]);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

function matches({ row, key }: ProjectedKeyedRow, where: readonly ProjectedCondition[]): boolean {
  return where.every(({ column, equals }) => (column === rowKeyColumn ? key : row[column]) === equals);
}

function brainOf(
  rows: ReadonlyMap<string, ProjectedKeyedRow>,
  brain: { readonly org: string; readonly brain: string },
): readonly ProjectedKeyedRow[] {
  return [...rows.values()].filter((kept) => kept.org === brain.org && kept.brain === brain.brain);
}

interface Staged {
  readonly rows: Map<string, ProjectedKeyedRow>;
  readonly stored: string;
  readonly kept: ProjectedKeyedRow;
}

function keyedFacts(projection: KeyedProjection, named: BrainStream, facts: readonly Fact[]) {
  return facts
    .filter(({ type }) => projection.types.includes(type))
    .flatMap((fact) => {
      const key = rowKeyOf(projection, fact.data, named);
      return key === undefined ? [] : [{ ...fact, key }];
    });
}

function staged({ projection, rows }: Table, stream: string, named: BrainStream, facts: readonly Fact[]) {
  const changed = new Map<string, ProjectedKeyedRow>();
  for (const { data, position, key } of keyedFacts(projection, named, facts)) {
    const stored = `${named.brainKey}${key}`;
    const row = (changed.get(stored) ?? rows.get(stored))?.row;
    const next = projection.rowAfter(row, data, { id: messageIdOf(stream, position), position });
    if (next !== undefined) {
      changed.set(stored, keyedRowOf(named.brainKey, key, next));
    }
  }
  return [...changed].map(([stored, kept]: readonly [string, ProjectedKeyedRow]): Staged => ({ rows, stored, kept }));
}

function dueOf({ row }: ProjectedKeyedRow, column: string): readonly number[] {
  const due = row[column];
  return typeof due === 'number' ? [due] : [];
}

function orderedKeyOf(orderBy: readonly string[], { row, key }: ProjectedKeyedRow): readonly Ordered[] {
  return [...orderBy.map((column) => row[column]), key];
}

function projectedOn(tables: readonly Table[]): MemoryProjections['project'] {
  return (stream, events, encoded, firstPosition) => {
    const named = brainStreamOf(stream);
    if (named === undefined) {
      return;
    }
    const facts = events.map(({ type }, index): Fact => ({
      type,
      data: encoded[index],
      position: firstPosition + index,
    }));
    const changes = tables.flatMap((table) => staged(table, stream, named, facts));
    for (const { rows, stored, kept } of changes) {
      rows.set(stored, kept);
    }
  };
}

interface Advance {
  readonly brain: BrainAddress;
  readonly key: string;
  readonly advance: RowAdvance;
}

function advancedIn(table: Table | undefined, { brain, key, advance }: Advance): Effect.Effect<void> {
  return Effect.sync(() => {
    if (table === undefined) {
      return;
    }
    requireAdvancedColumns(table.projection, advance.set);
    const stored = `${streamPrefixOfBrain(brain)}${key}`;
    const kept = table.rows.get(stored);
    if (kept !== undefined && matches(kept, advance.when)) {
      table.rows.set(stored, { ...kept, row: { ...kept.row, ...advance.set } });
    }
  });
}

function dueRowsIn(rows: ReadonlyMap<string, ProjectedKeyedRow>, { column, through, limit }: DueRowsQuery) {
  return [...rows.values()]
    .flatMap((kept) => dueOf(kept, column).map((due): readonly [number, ProjectedKeyedRow] => [due, kept]))
    .filter(([due]) => due <= through)
    .toSorted(([leftDue, left], [rightDue, right]) =>
      tupleCompared([leftDue, streamPrefixOfBrain(left), left.key], [rightDue, streamPrefixOfBrain(right), right.key]),
    )
    .slice(0, limit)
    .map(([, kept]) => kept);
}

function pageIn(
  rows: readonly ProjectedKeyedRow[],
  { where, orderBy, order, after, limit }: ProjectedRowsQuery,
): readonly ProjectedKeyedRow[] {
  const sign = order === 'asc' ? 1 : -1;
  return rows
    .filter((kept) => matches(kept, where))
    .filter((kept) => after === undefined || sign * tupleCompared(orderedKeyOf(orderBy, kept), after) > 0)
    .toSorted((left, right) => sign * tupleCompared(orderedKeyOf(orderBy, left), orderedKeyOf(orderBy, right)))
    .slice(0, limit);
}

export function memoryProjections(projections: readonly KeyedProjection[]): MemoryProjections {
  const tables: readonly Table[] = projections.map((projection) => ({
    projection: checkedProjection(projection),
    rows: new Map(),
  }));
  const tableNamed = (name: string): Table | undefined => tables.find(({ projection }) => projection.name === name);
  const rowsOf = (name: string): ReadonlyMap<string, ProjectedKeyedRow> => tableNamed(name)?.rows ?? nothingKept;
  return {
    project: projectedOn(tables),
    advanceRow: (projection, brain, key, advance) => advancedIn(tableNamed(projection), { brain, key, advance }),
    readProjectedRows: (projection, brain, query) =>
      Effect.sync(() => pageIn(brainOf(rowsOf(projection), brain), query)),
    countProjectedRows: (projection, brain, where) =>
      Effect.sync(() => brainOf(rowsOf(projection), brain).filter((kept) => matches(kept, where)).length),
    readDueRows: (projection, query) => Effect.sync(() => dueRowsIn(rowsOf(projection), query)),
    nextDueOf: (projection, column, after) =>
      Effect.sync(() => {
        const due = [...rowsOf(projection).values()].flatMap((kept) => dueOf(kept, column)).filter((at) => at > after);
        return due.length === 0 ? null : Math.min(...due);
      }),
  };
}
