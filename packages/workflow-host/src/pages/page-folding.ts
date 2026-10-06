import type { FoldedView, FoldingView, FoldOutcome, FoldRequest } from '@beonauto/workflow-engine/dsl';
import { Array, Effect, type Semaphore } from 'effect';

import { pageDeadlineMs, waitForAWorkerMs, type ProjectorSettings } from '../projector/projector-settings.ts';
import { isAfter } from '../views/view-points.ts';
import type { StallCause, ViewRow } from '../views/view-rows.ts';
import type { PageEvent, ReadPage } from './page-events.ts';
import { hasChanged, lostPageChanges, viewChangeOf, type Retries, type ViewChange } from './view-changes.ts';

export interface FoldedPageResult {
  readonly changes: readonly ViewChange[];
  readonly complete: boolean;
  readonly again: boolean;
  readonly trouble?: string;
}

export interface PageFolding {
  readonly settings: ProjectorSettings;
  readonly share: Semaphore.Semaphore;
}

const runSourcePrefix = '/executions/';

const stoppedBy = { deadline: 'time', memory: 'memory' } as const satisfies Readonly<Record<string, StallCause>>;

function isOwnRun({ event }: PageEvent, ownSubject: string): boolean {
  return event.source.startsWith(runSourcePrefix) && event.subject === ownSubject;
}

function consideredBy(row: ViewRow, page: ReadPage, definitionType: string): readonly number[] {
  const types = new Set(row.details.filters.map(({ type }) => type));
  const ownSubject = `${definitionType}/${row.name}`;
  return page.events.flatMap((placed, index) =>
    isAfter(placed.point, row.checkpoint) && types.has(placed.event.type) && !isOwnRun(placed, ownSubject)
      ? [index]
      : [],
  );
}

function foldingViewOf(row: ViewRow, page: ReadPage, definitionType: string): FoldingView {
  const { details } = row;
  return {
    fold: details.fold,
    filters: details.filters,
    view: row.view,
    ...(details.schema === undefined ? {} : { schema: details.schema }),
    events: consideredBy(row, page, definitionType),
  };
}

function requestOf(
  rows: readonly ViewRow[],
  page: ReadPage,
  { folding, definitionType }: ProjectorSettings,
): FoldRequest {
  return {
    ...folding,
    events: page.events.map(({ event }) => event),
    views: rows.map((row) => foldingViewOf(row, page, definitionType)),
    waitMs: waitForAWorkerMs,
    deadlineMs: pageDeadlineMs(folding),
  };
}

function retriesOf({ overtimesBeforeStall, folding }: ProjectorSettings): Retries {
  return { overtimesBeforeStall, foldDeadlineMs: folding.foldDeadlineMs };
}

function causeOf(outcome: FoldOutcome): StallCause | undefined {
  if (outcome.ran === 'crashed') {
    return 'crash';
  }
  if (outcome.ran !== 'stopped') {
    return undefined;
  }
  return outcome.because === 'deadline' || outcome.because === 'memory' ? stoppedBy[outcome.because] : undefined;
}

function troubleOf(outcome: Exclude<FoldOutcome, { readonly ran: 'folded' }>, kind: StallCause | undefined) {
  if (outcome.ran === 'unreadable') {
    return { trouble: 'A worker answered a page of folds with something it could not read' };
  }
  if (outcome.ran === 'crashed') {
    return { trouble: `A page of folds crashed before it named a fold: ${outcome.detail}` };
  }
  return kind === undefined
    ? {}
    : { trouble: `A page of folds was stopped by its ${outcome.because} before it named a fold` };
}

function settledBy(rows: readonly ViewRow[], page: ReadPage, outcome: FoldOutcome, retries: Retries): FoldedPageResult {
  if (outcome.ran === 'folded') {
    const end = { through: outcome.through, early: outcome.early };
    const changes = Array.zip(rows, outcome.views).map(([row, folded]: readonly [ViewRow, FoldedView]) =>
      viewChangeOf(row, folded, { page, end, retries }),
    );
    return { changes: changes.filter((change) => hasChanged(change)), complete: !outcome.early, again: false };
  }
  const kind = causeOf(outcome);
  const progress = 'progress' in outcome ? outcome.progress : undefined;
  const lost =
    progress === undefined || kind === undefined ? [] : lostPageChanges(rows, page, { progress, kind, retries });
  return lost.length === 0
    ? { changes: [], complete: false, again: true, ...troubleOf(outcome, kind) }
    : { changes: lost, complete: false, again: true };
}

function untouched(rows: readonly ViewRow[], page: ReadPage, retries: Retries): FoldedPageResult {
  const end = { through: -1, early: false };
  const views = rows.map((row) => ({ view: row.view, folded: 0, lastFolded: -1, work: 0 }));
  return settledBy(rows, page, { ran: 'folded', ...end, views, milliseconds: 0 }, retries);
}

export function foldedPage(rows: readonly ViewRow[], page: ReadPage, { settings, share }: PageFolding) {
  const retries = retriesOf(settings);
  const request = requestOf(rows, page, settings);
  if (request.views.every(({ events }) => events.length === 0)) {
    return Effect.succeed(untouched(rows, page, retries));
  }
  return share
    .withPermits(1)(Effect.promise((signal) => settings.pool.fold(request, signal)))
    .pipe(Effect.map((outcome) => settledBy(rows, page, outcome, retries)));
}
