import { Effect } from 'effect';

import { streamPrefixOfBrain } from '../ledger/bound-ports.ts';
import type { TypedEvent } from '../ledger/decider.ts';
import { messageIdOf } from '../ledger/message-lineage.ts';
import { runStreamOf } from '../run-outcomes/run-outcomes.ts';
import {
  checkedProjection,
  type ProjectedCondition,
  type ProjectedRow,
  type ProjectedRunRow,
  type ProjectedValue,
  type ProjectionReader,
  type RunProjection,
} from './run-projection.ts';

export interface MemoryProjections extends ProjectionReader {
  readonly project: (
    stream: string,
    events: readonly TypedEvent[],
    encoded: readonly unknown[],
    firstPosition: number,
  ) => void;
}

interface Table {
  readonly projection: RunProjection;
  readonly rows: Map<string, ProjectedRunRow>;
}

type Fact = readonly [TypedEvent, unknown, number];

const brainKey = /^brain\/(?<org>[^/]+)\/(?<brain>[^/]+)\/$/u;

const nothingKept: ReadonlyMap<string, ProjectedRunRow> = new Map();

function runRowOf(key: string, runId: string, row: ProjectedRow): ProjectedRunRow {
  const groups = brainKey.exec(key)?.groups;
  return { org: String(groups?.['org']), brain: String(groups?.['brain']), runId, row };
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

function matches({ row }: ProjectedRunRow, where: readonly ProjectedCondition[]): boolean {
  return where.every(({ column, equals }) => row[column] === equals);
}

function brainOf(
  rows: ReadonlyMap<string, ProjectedRunRow>,
  brain: { readonly org: string; readonly brain: string },
): readonly ProjectedRunRow[] {
  return [...rows.values()].filter((kept) => kept.org === brain.org && kept.brain === brain.brain);
}

function rowAfterFacts(
  projection: RunProjection,
  kept: ProjectedRow | undefined,
  stream: string,
  facts: readonly Fact[],
): ProjectedRow | undefined {
  let row = kept;
  let changed = false;
  for (const [, data, position] of facts.filter(([{ type }]) => projection.types.includes(type))) {
    const next = projection.rowAfter(row, data, { id: messageIdOf(stream, position), position });
    changed ||= next !== undefined;
    row = next ?? row;
  }
  return changed ? row : undefined;
}

interface Staged {
  readonly rows: Map<string, ProjectedRunRow>;
  readonly key: string;
  readonly row: ProjectedRunRow;
}

function staged({ projection, rows }: Table, stream: string, facts: readonly Fact[]): readonly Staged[] {
  const run = runStreamOf(stream);
  if (run === undefined) {
    return [];
  }
  const key = `${run.brainKey}${run.runId}`;
  const row = rowAfterFacts(projection, rows.get(key)?.row, stream, facts);
  return row === undefined ? [] : [{ rows, key, row: runRowOf(run.brainKey, run.runId, row) }];
}

function dueOf({ row }: ProjectedRunRow, column: string): readonly number[] {
  const due = row[column];
  return typeof due === 'number' ? [due] : [];
}

function keyOf(orderBy: readonly string[], { row, runId }: ProjectedRunRow): readonly Ordered[] {
  return [...orderBy.map((column) => row[column]), runId];
}

export function memoryProjections(projections: readonly RunProjection[]): MemoryProjections {
  const tables: readonly Table[] = projections.map((projection) => ({
    projection: checkedProjection(projection),
    rows: new Map(),
  }));
  const rowsOf = (name: string): ReadonlyMap<string, ProjectedRunRow> =>
    tables.find(({ projection }) => projection.name === name)?.rows ?? nothingKept;
  return {
    project: (stream, events, encoded, firstPosition) => {
      const facts = events.map((event, index): Fact => [event, encoded[index], firstPosition + index]);
      const changes = tables.flatMap((table) => staged(table, stream, facts));
      for (const { rows, key, row } of changes) {
        rows.set(key, row);
      }
    },
    readProjectedRows: (projection, brain, { where, orderBy, order, after, limit }) =>
      Effect.sync(() => {
        const sign = order === 'asc' ? 1 : -1;
        return brainOf(rowsOf(projection), brain)
          .filter((kept) => matches(kept, where))
          .filter((kept) => after === undefined || sign * tupleCompared(keyOf(orderBy, kept), after) > 0)
          .toSorted((left, right) => sign * tupleCompared(keyOf(orderBy, left), keyOf(orderBy, right)))
          .slice(0, limit);
      }),
    countProjectedRows: (projection, brain, where) =>
      Effect.sync(() => brainOf(rowsOf(projection), brain).filter((kept) => matches(kept, where)).length),
    readDueRows: (projection, { column, through, limit }) =>
      Effect.sync(() =>
        [...rowsOf(projection).values()]
          .flatMap((kept) => dueOf(kept, column).map((due): readonly [number, ProjectedRunRow] => [due, kept]))
          .filter(([due]) => due <= through)
          .toSorted(([leftDue, left], [rightDue, right]) =>
            tupleCompared(
              [leftDue, streamPrefixOfBrain(left), left.runId],
              [rightDue, streamPrefixOfBrain(right), right.runId],
            ),
          )
          .slice(0, limit)
          .map(([, kept]) => kept),
      ),
    nextDueOf: (projection, column, after) =>
      Effect.sync(() => {
        const due = [...rowsOf(projection).values()].flatMap((kept) => dueOf(kept, column)).filter((at) => at > after);
        return due.length === 0 ? null : Math.min(...due);
      }),
  };
}
