import type { FilterSandbox } from '@beonauto/workflow-engine';
import {
  comparePoints,
  isAfter,
  type DatabaseFailed,
  type FoldedChanges,
  type HostDatabase,
  type PageEvent,
  type ReadPage,
} from '@beonauto/workflow-host';
import { Effect } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { periodForm, periodOfForm } from '../periods/grains.ts';
import { eventMatchOf } from './dataset-matching.ts';
import { mergedRows, type MergedRow } from './dataset-merging.ts';
import { standingOf, type DatasetRow, type DatasetStanding } from './dataset-rows.ts';
import { eventReadingOf, type Contribution } from './event-values.ts';

export type DatasetStrikes = Map<string, { readonly record: string; readonly inARow: number }>;

interface PassedOverEvent {
  readonly record: string;
  readonly detail: string;
}

export interface DatasetChange {
  readonly row: DatasetRow;
  readonly next: DatasetStanding;
  readonly upserts: readonly MergedRow[];
  readonly passedOver: readonly PassedOverEvent[];
}

interface Read {
  readonly contributions: readonly Contribution[];
  readonly passedOver: readonly PassedOverEvent[];
  readonly cutAt: PageEvent | undefined;
  readonly lastRead: PageEvent | undefined;
}

const nothingRead: Read = { contributions: [], passedOver: [], cutAt: undefined, lastRead: undefined };

function passedOver(read: Read, placed: PageEvent, detail: string): Read {
  return { ...read, passedOver: [...read.passedOver, { record: placed.record, detail }], lastRead: placed };
}

interface Stop {
  readonly placed: PageEvent;
  readonly detail: string;
}

function struckAt(strikes: DatasetStrikes, row: DatasetRow, read: Read, { placed, detail }: Stop): Read {
  const key = `${row.playbookKey}${row.dataSha256}`;
  const struck = strikes.get(key);
  const inARow = struck?.record === placed.record ? struck.inARow + 1 : 1;
  if (inARow < predictionBounds.stopsBeforePassingOver) {
    strikes.set(key, { record: placed.record, inARow });
    return { ...read, cutAt: placed };
  }
  strikes.delete(key);
  return passedOver(read, placed, detail);
}

function readFrom(
  row: DatasetRow,
  events: readonly PageEvent[],
  sandbox: FilterSandbox,
  strikes: DatasetStrikes,
): Effect.Effect<Read> {
  return Effect.reduce(
    events,
    () => nothingRead,
    (read: Read, placed: PageEvent) =>
      read.cutAt === undefined
        ? Effect.map(eventMatchOf(row.data, placed, sandbox), (match): Read => {
            if (match.kind === 'stopped') {
              return struckAt(strikes, row, read, { placed, detail: match.detail });
            }
            if (match.kind === 'refused') {
              return passedOver(read, placed, match.detail);
            }
            if (match.kind === 'not_taken') {
              return { ...read, lastRead: placed };
            }
            const reading = eventReadingOf(row.data, placed);
            return 'refusal' in reading
              ? passedOver(read, placed, reading.refusal)
              : { ...read, contributions: [...read.contributions, reading.contribution], lastRead: placed };
          })
        : Effect.succeed(read),
  );
}

function reachedOf(page: ReadPage, { cutAt, lastRead }: Read): ReadPage['lastExamined'] {
  if (cutAt === undefined) {
    return page.lastExamined;
  }
  return lastRead === undefined ? undefined : { point: lastRead.point, recordedAt: lastRead.recordedAt };
}

function checkpointOf(
  row: DatasetRow,
  page: ReadPage,
  read: Read,
): Pick<DatasetStanding, 'checkpoint' | 'checkpointAt'> {
  const reached = reachedOf(page, read);
  return reached !== undefined && comparePoints(reached.point, row.checkpoint) > 0
    ? { checkpoint: reached.point, checkpointAt: reached.recordedAt }
    : { checkpoint: row.checkpoint, checkpointAt: row.checkpointAt };
}

function periodsOf(
  row: DatasetRow,
  upserts: readonly MergedRow[],
): Pick<DatasetStanding, 'firstPeriod' | 'lastPeriod'> {
  const grain = row.data.period;
  const known = [row.firstPeriod, row.lastPeriod].flatMap((form) =>
    form === null ? [] : [Number(periodOfForm(grain, form))],
  );
  const periods = [...known, ...upserts.map(({ period }) => period)];
  return periods.length === 0
    ? { firstPeriod: row.firstPeriod, lastPeriod: row.lastPeriod }
    : { firstPeriod: periodForm(grain, Math.min(...periods)), lastPeriod: periodForm(grain, Math.max(...periods)) };
}

function changeOf(row: DatasetRow, page: ReadPage, database: HostDatabase, folding: Folding) {
  const considered = new Set(row.data.events.map(({ type }) => type));
  const events = page.events.filter(({ point, event }) => isAfter(point, row.checkpoint) && considered.has(event.type));
  return Effect.gen(function* () {
    const read = yield* readFrom(row, events, folding.sandbox, folding.strikes);
    const merged = yield* mergedRows(database, row, read.contributions);
    const next: DatasetStanding = {
      ...standingOf(row),
      ...checkpointOf(row, page, read),
      ...periodsOf(row, merged.rows),
      rows: row.rows + merged.newRows,
      series: row.series + merged.newSeries,
      eventsFolded: row.eventsFolded + read.contributions.length,
      passedOver: row.passedOver + read.passedOver.length,
    };
    const change: DatasetChange = { row, next, upserts: merged.rows, passedOver: read.passedOver };
    return { change, cut: read.cutAt !== undefined };
  });
}

export function hasDatasetChanged({ row, next }: DatasetChange): boolean {
  return (
    next.phase !== row.phase ||
    next.eventsFolded !== row.eventsFolded ||
    next.passedOver !== row.passedOver ||
    comparePoints(next.checkpoint, row.checkpoint) !== 0
  );
}

interface Folding {
  readonly sandbox: FilterSandbox;
  readonly strikes: DatasetStrikes;
}

export function foldedDatasets(
  rows: readonly DatasetRow[],
  page: ReadPage,
  database: HostDatabase,
  folding: Folding,
): Effect.Effect<FoldedChanges<DatasetChange>, DatabaseFailed> {
  return Effect.map(
    Effect.forEach(rows, (row) => changeOf(row, page, database, folding)),
    (folded: readonly { readonly change: DatasetChange; readonly cut: boolean }[]) => ({
      changes: folded.map(({ change }) => change).filter((change) => hasDatasetChanged(change)),
      resting: folded.filter(({ cut }) => cut).map(({ change }) => change.row.dataSha256),
      complete: !folded.some(({ cut }) => cut),
      again: false,
    }),
  );
}
