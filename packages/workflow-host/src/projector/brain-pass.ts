import { Effect, type Semaphore } from 'effect';

import type { DatabaseFailed } from '../database/host-database.ts';
import { readPage, typesToRead, type ReadPage } from '../pages/page-events.ts';
import { foldedPage, type FoldedPageResult } from '../pages/page-folding.ts';
import { hasChanged, rowAfter, type ViewChange } from '../pages/view-changes.ts';
import { comparePoints, earliestOf } from '../views/view-points.ts';
import type { ViewRow } from '../views/view-rows.ts';
import { applied, type ChangeWriting, type Pass } from './change-writing.ts';
import type { ProjectorSettings } from './projector-settings.ts';
import { reconciled, type Reconciling } from './view-reconciling.ts';

export interface PassParts extends ChangeWriting {
  readonly settings: ProjectorSettings;
  readonly share: Semaphore.Semaphore;
  readonly reconciling: Reconciling;
  readonly firstSeen: (record: string) => boolean;
  readonly trouble: (what: string) => Effect.Effect<void>;
}

type Step = { readonly pass: Pass; readonly done: boolean; readonly again: boolean };

function isLive({ phase }: ViewRow): boolean {
  return phase === 'live';
}

function typesOf(rows: readonly ViewRow[]): readonly string[] {
  return typesToRead(rows.flatMap(({ details }) => details.filters.map(({ type }) => type)));
}

function noted(parts: PassParts, brain: string, page: ReadPage): Effect.Effect<void> {
  return Effect.forEach(
    page.passedOver.filter(({ record }) => parts.firstSeen(record)),
    ({ record, reason }) => parts.note({ kind: 'record_passed_over', brain, record, reason }),
    { discard: true },
  );
}

function readFor(parts: PassParts, brain: string, rows: readonly ViewRow[]): Effect.Effect<ReadPage> {
  const { settings, database } = parts;
  const after = earliestOf(rows.map(({ checkpoint }) => checkpoint));
  return Effect.promise(() =>
    readPage(database.store, { brainKey: brain, after, types: typesOf(rows), definitionType: settings.definitionType }),
  ).pipe(Effect.tap((page) => noted(parts, brain, page)));
}

function troubled(parts: PassParts, result: FoldedPageResult): Effect.Effect<void> {
  return result.trouble === undefined ? Effect.void : parts.trouble(result.trouble);
}

function sharedStep(parts: PassParts, brain: string, pass: Pass): Effect.Effect<Step, DatabaseFailed> {
  return Effect.gen(function* () {
    const live = pass.rows.filter((row) => isLive(row));
    if (live.length === 0 || pass.pages === 0) {
      return { pass, done: true, again: false };
    }
    const page = yield* readFor(parts, brain, live);
    const result = yield* foldedPage(live, page, parts);
    yield* troubled(parts, result);
    const after = yield* applied(parts, brain, { rows: pass.rows, pages: pass.pages - 1 }, result.changes);
    const rows = page.definitionsSeen ? yield* reconciled(parts.reconciling, brain) : after.rows;
    return {
      pass: { rows, pages: after.pages },
      done: result.again || (result.complete && page.atTheEnd),
      again: result.again,
    };
  });
}

function caughtUp(row: ViewRow, rows: readonly ViewRow[], atTheEnd: boolean): boolean {
  const live = rows.filter((other) => other.name !== row.name && isLive(other));
  return live.length === 0
    ? atTheEnd
    : atTheEnd || comparePoints(row.checkpoint, earliestOf(live.map(({ checkpoint }) => checkpoint))) >= 0;
}

function joining(change: ViewChange, rows: readonly ViewRow[], atTheEnd: boolean): ViewChange {
  const after = rowAfter(change);
  return after.phase === 'rebuilding' && caughtUp(after, rows, atTheEnd)
    ? { row: change.row, next: { ...change.next, phase: 'live' } }
    : change;
}

function unchanged(row: ViewRow): ViewChange {
  const { view, checkpoint, checkpointAt, lastEvent, folded, overtimes, phase } = row;
  return { row, next: { view, checkpoint, checkpointAt, lastEvent, folded, overtimes, phase } };
}

function rebuildStep(parts: PassParts, brain: string, pass: Pass, row: ViewRow): Effect.Effect<Step, DatabaseFailed> {
  return Effect.gen(function* () {
    const page = yield* readFor(parts, brain, [row]);
    const result = yield* foldedPage([row], page, parts);
    yield* troubled(parts, result);
    const change = result.changes[0] ?? unchanged(row);
    const settled = result.again ? change : joining(change, pass.rows, result.complete && page.atTheEnd);
    const moved = hasChanged(settled) ? [settled] : [];
    const after = yield* applied(parts, brain, { rows: pass.rows, pages: pass.pages - 1 }, moved);
    const now = after.rows.find(({ name }) => name === row.name);
    return { pass: after, done: result.again || now?.phase !== 'rebuilding', again: result.again };
  });
}

function stepped(
  start: Pass,
  step: (pass: Pass) => Effect.Effect<Step, DatabaseFailed>,
): Effect.Effect<Step, DatabaseFailed> {
  const going = (reached: Step): Effect.Effect<Step, DatabaseFailed> =>
    reached.done ? Effect.succeed(reached) : Effect.flatMap(step(reached.pass), going);
  return going({ pass: start, done: false, again: false });
}

function rebuilt(parts: PassParts, brain: string, start: Step): Effect.Effect<Step, DatabaseFailed> {
  const rebuilding = start.pass.rows.filter(({ phase }) => phase === 'rebuilding');
  return Effect.reduce(
    rebuilding,
    () => start,
    (reached: Step, row: ViewRow) =>
      reached.again || reached.pass.pages === 0
        ? Effect.succeed(reached)
        : stepped(reached.pass, (pass) => {
            const current = pass.rows.find(({ name }) => name === row.name);
            return current === undefined || pass.pages === 0
              ? Effect.succeed({ pass, done: true, again: false })
              : rebuildStep(parts, brain, pass, current);
          }).pipe(Effect.map((step) => ({ ...step, again: reached.again || step.again }))),
  );
}

export function brainPass(parts: PassParts, brain: string): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.gen(function* () {
    const rows = yield* reconciled(parts.reconciling, brain);
    const shared = yield* stepped({ rows, pages: parts.settings.pagesPerWake }, (pass) =>
      sharedStep(parts, brain, pass),
    );
    const done = yield* rebuilt(parts, brain, shared);
    const building = done.pass.rows.some(({ phase }) => phase === 'rebuilding' || phase === 'waiting');
    return !done.again && (done.pass.pages === 0 || building);
  });
}
