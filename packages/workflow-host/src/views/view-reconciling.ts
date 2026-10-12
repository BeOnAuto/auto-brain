import { Effect } from 'effect';
import { Schema } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { Statement } from '../database/statement.ts';
import type { BrainDefinitions, KeptFunction } from '../projector/brain-definitions.ts';
import type { Reconciling, RowPhase } from '../projector/folder.ts';
import { viewDetailsOf, type ViewDetails } from './view-details.ts';
import { viewRowOf, ViewRowSchema, type ViewRow } from './view-rows.ts';
import {
  brainsWithViews,
  phaseSet,
  viewAdded,
  viewDropped,
  viewRenewed,
  viewsOfBrain,
  type NewView,
} from './view-statements.ts';

const BrainRow = Schema.Struct({ brain: Schema.String });

export function brainsWithViewsIn(database: HostDatabase): Effect.Effect<readonly string[], DatabaseFailed> {
  return Effect.map(rowsOf(BrainRow, database.read(brainsWithViews)), (rows) => rows.map(({ brain }) => brain));
}

export function rowsOfBrain(database: HostDatabase, brain: string): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  return rowsOf(ViewRowSchema, database.read(viewsOfBrain(brain))).pipe(
    Effect.map((rows) => rows.map((row) => viewRowOf(row))),
  );
}

interface Saved {
  readonly name: string;
  readonly saved: number;
}

interface FreshFunction extends Saved {
  readonly version: number;
  readonly details: ViewDetails;
}

function isBuilding({ phase }: ViewRow): boolean {
  return phase === 'waiting' || phase === 'rebuilding';
}

function slotsOf(building: readonly Saved[], rebuildsAtOnce: number): ReadonlySet<string> {
  const inOrderSaved = building.toSorted((one, other) => one.saved - other.saved);
  return new Set(inOrderSaved.slice(0, rebuildsAtOnce).map(({ name }) => name));
}

function phaseIn(slots: ReadonlySet<string>, name: string): RowPhase {
  return slots.has(name) ? 'rebuilding' : 'waiting';
}

function freshOf(name: string, kept: KeptFunction, row: ViewRow | undefined): readonly FreshFunction[] {
  const details = viewDetailsOf(kept.details);
  return details === undefined || (row !== undefined && row.version >= kept.version)
    ? []
    : [{ name, saved: kept.saved, version: kept.version, details }];
}

function newViewOf(brain: string, { name, saved, version, details }: FreshFunction, phase: RowPhase): NewView {
  return {
    brain,
    name,
    version,
    saved,
    details: JSON.stringify(details),
    phase,
    view: JSON.stringify(details.initial),
  };
}

function changesOf(
  brain: string,
  rows: readonly ViewRow[],
  { functions }: BrainDefinitions,
  rebuildsAtOnce: number,
): readonly Statement[] {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const fresh = [...functions].flatMap(([name, kept]: readonly [string, KeptFunction]) =>
    freshOf(name, kept, byName.get(name)),
  );
  const freshNames = new Set(fresh.map(({ name }) => name));
  const stillBuilding = rows.filter((row) => isBuilding(row) && functions.has(row.name) && !freshNames.has(row.name));
  const slots = slotsOf([...stillBuilding, ...fresh], rebuildsAtOnce);
  const promoted = stillBuilding
    .filter((row) => row.phase === 'waiting' && slots.has(row.name))
    .map((row) => phaseSet(row, 'rebuilding'));
  const dropped = rows.filter(({ name }) => !functions.has(name)).map(({ name }) => viewDropped(brain, name));
  const written = fresh.map((function_) => {
    const view = newViewOf(brain, function_, phaseIn(slots, function_.name));
    return byName.has(view.name) ? viewRenewed(view) : viewAdded(view);
  });
  return [...promoted, ...dropped, ...written];
}

function phasesOf(rows: readonly ViewRow[], rebuildsAtOnce: number): readonly ViewRow[] {
  const slots = slotsOf(
    rows.filter((row) => isBuilding(row)),
    rebuildsAtOnce,
  );
  return rows.map((row) => (isBuilding(row) ? { ...row, phase: phaseIn(slots, row.name) } : row));
}

export function reconciledViews(
  { database, brain, definitions, rebuildsAtOnce }: Reconciling,
  before: readonly ViewRow[],
): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  return Effect.gen(function* () {
    const changes = changesOf(brain, before, definitions, rebuildsAtOnce);
    yield* Effect.forEach(changes, database.write, { discard: true });
    const rows = changes.length === 0 ? before : yield* rowsOfBrain(database, brain);
    const phased = phasesOf(rows, rebuildsAtOnce);
    const moved = phased.filter((row, index) => row.phase !== rows[index]?.phase);
    yield* Effect.forEach(moved, (row) => database.write(phaseSet(row, row.phase)), { discard: true });
    return phased;
  });
}
