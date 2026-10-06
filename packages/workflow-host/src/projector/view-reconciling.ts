import { Effect } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { Statement } from '../database/statement.ts';
import { viewDetailsOf } from '../views/view-details.ts';
import type { ViewRow } from '../views/view-rows.ts';
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

function newViewOf(brain: string, name: string, kept: KeptFunction): NewView | undefined {
  const details = viewDetailsOf(kept.details);
  return details === undefined
    ? undefined
    : {
        brain,
        name,
        version: kept.version,
        saved: kept.saved,
        details: JSON.stringify(details),
        phase: 'waiting',
        view: JSON.stringify(details.initial),
      };
}

function changesOf(brain: string, rows: readonly ViewRow[], { functions }: BrainDefinitions): readonly Statement[] {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const kept = [...functions].flatMap(([name, function_]: readonly [string, KeptFunction]): readonly Statement[] => {
    const added = newViewOf(brain, name, function_);
    const row = byName.get(name);
    if (added === undefined || (row !== undefined && row.version >= added.version)) {
      return [];
    }
    return [row === undefined ? viewAdded(added) : viewRenewed(added)];
  });
  const dropped = rows.filter(({ name }) => !functions.has(name)).map(({ name }) => viewDropped(brain, name));
  return [...kept, ...dropped];
}

function phasesOf(rows: readonly ViewRow[], rebuildsAtOnce: number): readonly ViewRow[] {
  const building = rows.filter(({ phase }) => phase === 'waiting' || phase === 'rebuilding');
  const slots = new Set(building.slice(0, rebuildsAtOnce).map(({ name }) => name));
  return rows.map((row) =>
    building.includes(row) ? { ...row, phase: slots.has(row.name) ? 'rebuilding' : 'waiting' } : row,
  );
}

export function reconciled(parts: Reconciling, brain: string): Effect.Effect<readonly ViewRow[], DatabaseFailed> {
  const { database } = parts;
  return Effect.gen(function* () {
    const definitions = yield* definitionsOf(parts, brain);
    const before = yield* rowsOfBrain(database, brain);
    yield* Effect.forEach(changesOf(brain, before, definitions), database.write, { discard: true });
    const rows = yield* rowsOfBrain(database, brain);
    const phased = phasesOf(rows, parts.rebuildsAtOnce);
    const moved = phased.filter((row, index) => row.phase !== rows[index]?.phase);
    yield* Effect.forEach(moved, (row) => database.write(phaseSet(row, row.phase)), { discard: true });
    return phased;
  });
}
