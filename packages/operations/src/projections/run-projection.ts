import type { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';

export type ProjectedValue = string | number | boolean | null;

export type ProjectedRow = Readonly<Record<string, ProjectedValue>>;

export type ProjectedColumnKind = 'text' | 'integer' | 'boolean';

export interface ProjectedColumn {
  readonly name: string;
  readonly kind: ProjectedColumnKind;
}

export interface ProjectedIndex {
  readonly name: string;
  readonly columns: readonly string[];
  readonly acrossBrains?: boolean;
  readonly whereSet?: string;
}

export interface ProjectedMessage {
  readonly id: string;
  readonly position: number;
}

export interface RunProjection {
  readonly name: string;
  readonly version: number;
  readonly types: readonly string[];
  readonly columns: readonly ProjectedColumn[];
  readonly indexes: readonly ProjectedIndex[];
  readonly rowAfter: (
    row: ProjectedRow | undefined,
    event: unknown,
    message: ProjectedMessage,
  ) => ProjectedRow | undefined;
}

export interface ProjectedCondition {
  readonly column: string;
  readonly equals: string | number | boolean;
}

export type ProjectedOrder = 'asc' | 'desc';

export interface ProjectedRowsQuery {
  readonly where: readonly ProjectedCondition[];
  readonly orderBy: readonly string[];
  readonly order: ProjectedOrder;
  readonly after?: readonly ProjectedValue[];
  readonly limit: number;
}

export interface ProjectedRunRow {
  readonly org: string;
  readonly brain: string;
  readonly runId: string;
  readonly row: ProjectedRow;
}

export interface DueRowsQuery {
  readonly column: string;
  readonly through: number;
  readonly limit: number;
}

export interface ProjectionReader {
  readonly readProjectedRows: (
    projection: string,
    brain: BrainAddress,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedRunRow[]>;
  readonly countProjectedRows: (
    projection: string,
    brain: BrainAddress,
    where: readonly ProjectedCondition[],
  ) => Effect.Effect<number>;
  readonly readDueRows: (projection: string, query: DueRowsQuery) => Effect.Effect<readonly ProjectedRunRow[]>;
  readonly nextDueOf: (projection: string, column: string) => Effect.Effect<number | null>;
}

export interface BrainProjectionReader {
  readonly readProjectedRows: (
    projection: string,
    query: ProjectedRowsQuery,
  ) => Effect.Effect<readonly ProjectedRunRow[]>;
  readonly countProjectedRows: (projection: string, where: readonly ProjectedCondition[]) => Effect.Effect<number>;
}

const projectionName = /^[a-z][a-z0-9_]{0,39}$/u;

const columnName = /^[a-z][a-z0-9_]{0,62}$/u;

const keyColumns: ReadonlySet<string> = new Set(['brain_key', 'run_id']);

function requireNamed(what: string, name: string, pattern: Readonly<RegExp>): void {
  if (!pattern.test(name)) {
    throw new Error(`The ${what} name ${name} is malformed`);
  }
}

function requireKnownColumns(projection: RunProjection, columns: readonly string[]): void {
  const known = new Set(projection.columns.map(({ name }) => name));
  const unknown = columns.find((column) => !known.has(column));
  if (unknown !== undefined) {
    throw new Error(`The projection ${projection.name} has no column ${unknown}`);
  }
}

export function checkedProjection(projection: RunProjection): RunProjection {
  requireNamed('projection', projection.name, projectionName);
  if (!Number.isSafeInteger(projection.version) || projection.version < 1) {
    throw new Error(`The projection ${projection.name} has a version that is not a whole number from 1`);
  }
  for (const { name } of projection.columns) {
    requireNamed('column', name, columnName);
    if (keyColumns.has(name)) {
      throw new Error(`The projection ${projection.name} may not name a column ${name}, which keys every row`);
    }
  }
  for (const index of projection.indexes) {
    requireNamed('index', index.name, columnName);
    requireKnownColumns(projection, [...index.columns, ...(index.whereSet === undefined ? [] : [index.whereSet])]);
  }
  return projection;
}

export function projectedTableOf({ name, version }: Pick<RunProjection, 'name' | 'version'>): string {
  return `${name}_${version}`;
}
