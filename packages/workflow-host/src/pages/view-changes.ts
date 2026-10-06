import type { StoredPlace } from '@beonauto/ledger';
import type { FoldedView, FoldPlace, FoldStall } from '@beonauto/workflow-engine/dsl';
import { Struct } from 'effect';

import { lineInFold } from '../views/view-details.ts';
import { comparePoints, pointText, type Point } from '../views/view-points.ts';
import type { StallCause, ViewRow, ViewStall } from '../views/view-rows.ts';
import type { FoldedRow } from '../views/view-statements.ts';
import type { PageEvent, ReadPage } from './page-events.ts';

export interface ViewChange {
  readonly row: ViewRow;
  readonly next: FoldedRow;
}

export interface Retries {
  readonly overtimesBeforeStall: number;
  readonly foldDeadlineMs: number;
}

interface PageEnd {
  readonly through: number;
  readonly early: boolean;
}

export interface FoldedPageOf {
  readonly page: ReadPage;
  readonly end: PageEnd;
  readonly retries: Retries;
}

interface Place {
  readonly point: Point | undefined;
  readonly at: string | null;
}

function laterOf(row: ViewRow, place: Place): Place {
  return comparePoints(place.point, row.checkpoint) > 0 ? place : { point: row.checkpoint, at: row.checkpointAt };
}

function placeOfEvent(event: PageEvent | undefined): Place {
  return event === undefined ? { point: undefined, at: null } : { point: event.point, at: event.recordedAt };
}

function placeOfStore(place: StoredPlace | undefined): Place {
  return place === undefined ? { point: undefined, at: null } : { point: place.point, at: place.recordedAt };
}

function before(row: ViewRow, page: ReadPage, index: number): Place {
  return laterOf(row, placeOfEvent(page.events[index - 1]));
}

function stalledEventOf(page: ReadPage, index: number): ViewStall['event'] {
  const event = page.events[index]?.event;
  return { id: String(event?.id), type: String(event?.type), time: String(event?.time) };
}

function rowAt(row: ViewRow, place: Place): Omit<FoldedRow, 'overtimes' | 'phase'> {
  return {
    view: row.view,
    checkpoint: place.point,
    checkpointAt: place.at,
    lastEvent: row.lastEvent,
    folded: row.folded,
  };
}

interface Overtime {
  readonly at: number;
  readonly kind: StallCause;
  readonly retries: Retries;
}

function overtimeOf(row: ViewRow, page: ReadPage, { at, kind, retries }: Overtime): FoldedRow {
  const place = before(row, page, at);
  const overtimes = row.overtimes + 1;
  if (overtimes < retries.overtimesBeforeStall) {
    return { ...rowAt(row, place), overtimes, phase: row.phase };
  }
  const stopped = kind === 'time' ? `its deadline of ${retries.foldDeadlineMs} ms` : `its ${kind}`;
  const stall = {
    event: stalledEventOf(page, at),
    kind,
    message: `The fold was stopped by ${stopped} ${overtimes} times`,
    line: null,
  };
  return { ...rowAt(row, place), overtimes, phase: 'stalled', stall };
}

function stalledOf(row: ViewRow, page: ReadPage, { at, kind, message, span }: FoldStall): FoldedRow {
  const line = span === null ? null : lineInFold(row.details, span.start);
  const stall = { event: stalledEventOf(page, at), kind, message, line };
  return { ...rowAt(row, before(row, page, at)), overtimes: row.overtimes, phase: 'stalled', stall };
}

function advancedBy(row: ViewRow, page: ReadPage, folded: FoldedView): ViewRow {
  const last = page.events[folded.lastFolded];
  return {
    ...row,
    view: folded.view,
    folded: row.folded + folded.folded,
    lastEvent: last === undefined ? row.lastEvent : { id: last.event.id, time: last.event.time },
  };
}

function endOf(row: ViewRow, { page, end }: FoldedPageOf): Place {
  return laterOf(row, end.early ? placeOfEvent(page.events[end.through]) : placeOfStore(page.lastExamined));
}

export function viewChangeOf(row: ViewRow, folded: FoldedView, of: FoldedPageOf): ViewChange {
  const advanced = advancedBy(row, of.page, folded);
  if (folded.stall !== undefined) {
    return { row, next: stalledOf(advanced, of.page, folded.stall) };
  }
  if (folded.overtime !== undefined) {
    return { row, next: overtimeOf(advanced, of.page, { at: folded.overtime, kind: 'time', retries: of.retries }) };
  }
  return { row, next: { ...rowAt(advanced, endOf(row, of)), overtimes: 0, phase: row.phase } };
}

export function lostPageChanges(
  rows: readonly ViewRow[],
  page: ReadPage,
  { progress, kind, retries }: { readonly progress: FoldPlace; readonly kind: StallCause; readonly retries: Retries },
): readonly ViewChange[] {
  const going = rows.slice(progress.view, progress.view + 1);
  return going.map((row) => ({ row, next: overtimeOf(row, page, { at: progress.event, kind, retries }) }));
}

export function hasChanged({ row, next }: ViewChange): boolean {
  return (
    next.phase !== row.phase ||
    next.overtimes !== row.overtimes ||
    next.folded !== row.folded ||
    comparePoints(next.checkpoint, row.checkpoint) !== 0
  );
}

export function rowAfter({ row, next }: ViewChange): ViewRow {
  return {
    ...Struct.omit(row, ['stall']),
    view: next.view,
    checkpoint: next.checkpoint,
    checkpointText: pointText(next.checkpoint),
    checkpointAt: next.checkpointAt,
    lastEvent: next.lastEvent,
    folded: next.folded,
    overtimes: next.overtimes,
    phase: next.phase,
    ...(next.stall === undefined ? {} : { stall: next.stall }),
  };
}
