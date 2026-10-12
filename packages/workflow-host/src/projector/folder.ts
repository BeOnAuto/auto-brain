import type { Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import type { ReadPage } from '../pages/page-events.ts';
import type { Point } from '../views/view-points.ts';
import type { BrainDefinitions, KeptOf } from './brain-definitions.ts';

export type RowPhase = 'waiting' | 'rebuilding' | 'live' | 'stalled';

export interface PassedRow {
  readonly phase: RowPhase;
  readonly checkpoint: Point | undefined;
}

export interface PassedChange<Row> {
  readonly row: Row;
  readonly next: PassedRow;
}

export interface FoldedChanges<Change> {
  readonly changes: readonly Change[];
  readonly resting: readonly string[];
  readonly complete: boolean;
  readonly again: boolean;
  readonly trouble?: string;
}

export interface Reconciling {
  readonly database: HostDatabase;
  readonly brain: string;
  readonly definitions: BrainDefinitions;
  readonly rebuildsAtOnce: number;
}

export interface Writing {
  readonly database: HostDatabase;
  readonly brain: string;
  readonly note: (note: HostNote) => Effect.Effect<void>;
}

export interface Folder<Row extends PassedRow, Change extends PassedChange<Row>> {
  readonly definitionType: string;
  readonly keptOf: KeptOf;
  readonly keyOf: (row: Row) => string;
  readonly typesOf: (row: Row) => readonly string[];
  readonly brainsWithRows: (database: HostDatabase) => Effect.Effect<readonly string[], DatabaseFailed>;
  readonly rowsOf: (database: HostDatabase, brain: string) => Effect.Effect<readonly Row[], DatabaseFailed>;
  readonly reconcile: (reconciling: Reconciling, rows: readonly Row[]) => Effect.Effect<readonly Row[], DatabaseFailed>;
  readonly fold: (
    rows: readonly Row[],
    page: ReadPage,
    database: HostDatabase,
  ) => Effect.Effect<FoldedChanges<Change>, DatabaseFailed>;
  readonly write: (writing: Writing, change: Change) => Effect.Effect<Row | undefined, DatabaseFailed>;
  readonly unchanged: (row: Row) => Change;
  readonly joinedLive: (change: Change) => Change;
  readonly hasChanged: (change: Change) => boolean;
}

export type SomeFolder = <Result>(
  use: <Row extends PassedRow, Change extends PassedChange<Row>>(folder: Folder<Row, Change>) => Result,
) => Result;

export function someFolder<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
): SomeFolder {
  return (use) => use(folder);
}
