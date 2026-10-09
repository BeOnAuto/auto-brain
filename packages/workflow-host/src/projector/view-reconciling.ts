import { Effect } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { Statement } from '../database/statement.ts';
import { viewDetailsOf, type ViewDetails } from '../views/view-details.ts';
import type { ViewPhase, ViewRow } from '../views/view-rows.ts';
import { viewRowOf, ViewRowSchema } from '../views/view-rows.ts';
import { phaseSet, viewAdded, viewDropped, viewRenewed, viewsOfBrain, type NewView } from '../views/view-statements.ts';
import {
  definitionsAfter,
  definitionStreamOf,
  noDefinitions,
  type BrainDefinitions,
  type KeptFunction,
} from './brain-definitions.ts';

export interface Reconciling {
  readonly database: HostDatabase;
  readonly definitionType: string;
  readonly rebuildsAtOnce: number;
  readonly definitions: Map<string, BrainDefinitions>;
}

export function rowsOfBrain(database: HostDatabase, brain: string): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  return rowsOf(ViewRowSchema, database.read(viewsOfBrain(brain))).pipe(
    Effect.map((rows) => rows.map((row) => viewRowOf(row))),
  );
}

function definitionsOf({ database, definitionType, definitions }: Reconciling, brain: string) {
  const known = definitions.get(brain) ?? noDefinitions;
  return Effect.promise(() => database.store.read(definitionStreamOf(brain, definitionType), known.version)).pipe(
    Effect.map(({ events }) => {
      const next = definitionsAfter(known, events);
      definitions.set(brain, next);
      return next;
    }),
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

function phaseIn(slots: ReadonlySet<string>, name: string): ViewPhase {
  return slots.has(name) ? 'rebuilding' : 'waiting';
}

function freshOf(name: string, kept: KeptFunction, row: ViewRow | undefined): readonly FreshFunction[] {
  const details = viewDetailsOf(kept.details);
  return details === undefined || (row !== undefined && row.version >= kept.version)
    ? []
    : [{ name, saved: kept.saved, version: kept.version, details }];
}

function newViewOf(brain: string, { name, saved, version, details }: FreshFunction, phase: ViewPhase): NewView {
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

export function reconciled(parts: Reconciling, brain: string): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  const { database } = parts;
  return Effect.gen(function* () {
    const definitions = yield* definitionsOf(parts, brain);
    const before = yield* rowsOfBrain(database, brain);
    const changes = changesOf(brain, before, definitions, parts.rebuildsAtOnce);
    yield* Effect.forEach(changes, database.write, { discard: true });
    const rows = changes.length === 0 ? before : yield* rowsOfBrain(database, brain);
    const phased = phasesOf(rows, parts.rebuildsAtOnce);
    const moved = phased.filter((row, index) => row.phase !== rows[index]?.phase);
    yield* Effect.forEach(moved, (row) => database.write(phaseSet(row, row.phase)), { discard: true });
    return phased;
  });
}
