import { Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import type { Statement } from '../database/statement.ts';
import { definitionsAfter, definitionStreamOf, noDefinitions, type BrainDefinitions } from './brain-definitions.ts';
import type { Folder, PassedChange, PassedRow, Reconciling, RowPhase } from './folder.ts';

export type KeptDefinitions = (definitionType: string) => Map<string, BrainDefinitions>;

export interface DefinitionsKept {
  readonly database: HostDatabase;
  readonly definitions: KeptDefinitions;
}

interface Placed {
  readonly key: string;
  readonly saved: number;
}

function isBuilding({ phase }: PassedRow): boolean {
  return phase === 'waiting' || phase === 'rebuilding';
}

function slotsOf(building: readonly Placed[], rebuildsAtOnce: number): ReadonlySet<string> {
  const inOrderSaved = building.toSorted((one, other) => one.saved - other.saved);
  return new Set(inOrderSaved.slice(0, rebuildsAtOnce).map(({ key }) => key));
}

function phaseIn(slots: ReadonlySet<string>, key: string): RowPhase {
  return slots.has(key) ? 'rebuilding' : 'waiting';
}

export function hasFreeSlot(rows: readonly PassedRow[], rebuildsAtOnce: number): boolean {
  const rebuilding = rows.filter(({ phase }) => phase === 'rebuilding');
  return rebuilding.length < rebuildsAtOnce && rows.some(({ phase }) => phase === 'waiting');
}

function placedOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  row: Row,
): Placed {
  return { key: folder.keyOf(row), saved: row.saved };
}

function changesOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  reconciling: Reconciling,
  rows: readonly Row[],
): readonly Statement[] {
  const { fresh, dropped } = folder.reconcile(reconciling, rows);
  const leaving = new Set([...fresh.map(({ key }) => key), ...dropped.map((row) => folder.keyOf(row))]);
  const stillBuilding = rows.filter((row) => isBuilding(row) && !leaving.has(folder.keyOf(row)));
  const slots = slotsOf([...stillBuilding.map((row) => placedOf(folder, row)), ...fresh], folder.rebuildsAtOnce);
  const promoted = stillBuilding.filter((row) => row.phase === 'waiting' && slots.has(folder.keyOf(row)));
  return [
    ...promoted.map((row) => folder.phased(row, 'rebuilding')),
    ...dropped.flatMap((row) => folder.dropped(row)),
    ...fresh.map(({ key, added }) => added(phaseIn(slots, key))),
  ];
}

function phasedBySlots<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  rows: readonly Row[],
): readonly Row[] {
  const building = rows.filter((row) => isBuilding(row)).map((row) => placedOf(folder, row));
  const slots = slotsOf(building, folder.rebuildsAtOnce);
  return rows.map((row) => (isBuilding(row) ? { ...row, phase: phaseIn(slots, folder.keyOf(row)) } : row));
}

function definitionsOf<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  { database, definitions }: DefinitionsKept,
  brain: string,
): Effect.Effect<BrainDefinitions> {
  const kept = definitions(folder.definitionType);
  const known = kept.get(brain) ?? noDefinitions;
  return Effect.promise(() =>
    database.store.read(definitionStreamOf(brain, folder.definitionType), known.version),
  ).pipe(
    Effect.map(({ messages }) => {
      const next = definitionsAfter(known, messages, folder.keptOf);
      kept.set(brain, next);
      return next;
    }),
  );
}

export function reconciledRows<Row extends PassedRow, Change extends PassedChange<Row>>(
  folder: Folder<Row, Change>,
  kept: DefinitionsKept,
  brain: string,
): Effect.Effect<readonly Row[], DatabaseFailed> {
  const { database } = kept;
  return Effect.gen(function* () {
    const definitions = yield* definitionsOf(folder, kept, brain);
    const before = yield* folder.rowsOf(database, brain);
    const changes = changesOf(folder, { brain, definitions }, before);
    yield* Effect.forEach(changes, database.write, { discard: true });
    const rows = changes.length === 0 ? before : yield* folder.rowsOf(database, brain);
    const phased = phasedBySlots(folder, rows);
    const moved = phased.filter((row, index) => row.phase !== rows[index]?.phase);
    yield* Effect.forEach(moved, (row) => database.write(folder.phased(row, row.phase)), { discard: true });
    return phased;
  });
}
