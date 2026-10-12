import { Effect, Option, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { statement, type Statement } from '../database/statement.ts';
import { comparePoints, isAfter, pointIn, pointText, type Point } from '../pages/history-points.ts';
import type { PageEvent, ReadPage } from '../pages/page-events.ts';
import type { BrainDefinitions } from '../projector/brain-definitions.ts';
import type { FoldedChanges, Folder, Reconciled, Reconciling, RowPhase, Writing } from '../projector/folder.ts';

export const tallyType = 'tally';

const talliesTable = statement`CREATE TABLE IF NOT EXISTS folder_tallies (
    brain TEXT NOT NULL,
    tally TEXT NOT NULL,
    saved BIGINT NOT NULL,
    phase TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    checkpoint_at TEXT,
    counted BIGINT NOT NULL,
    PRIMARY KEY (brain, tally)
  )`;

const TallyDetailsSchema = Schema.Struct({
  counts: Schema.String,
  stallsOn: Schema.optionalKey(Schema.String),
});

export type TallyDetails = typeof TallyDetailsSchema.Type;

const TallyKeySchema = Schema.fromJsonString(
  Schema.Struct({ counts: Schema.String, stallsOn: Schema.NullOr(Schema.String) }),
);

const StoredTallySchema = Schema.Struct({
  brain: Schema.String,
  tally: Schema.String,
  saved: WholeNumber,
  phase: Schema.Literals(['waiting', 'rebuilding', 'live', 'stalled']),
  checkpoint: Schema.String,
  checkpoint_at: Schema.NullOr(Schema.String),
  counted: WholeNumber,
});

const TallyNameSchema = Schema.Struct({ tally: Schema.String });

const BrainSchema = Schema.Struct({ brain: Schema.String });

const decodeDetails = Schema.decodeUnknownOption(TallyDetailsSchema);

const decodeKey = Schema.decodeUnknownSync(TallyKeySchema);

interface TallyNext {
  readonly phase: RowPhase;
  readonly checkpoint: Point | undefined;
  readonly checkpointAt: string | null;
  readonly counted: number;
}

export interface TallyRow extends TallyNext {
  readonly brain: string;
  readonly tally: string;
  readonly counts: string;
  readonly stallsOn: string | null;
  readonly saved: number;
  readonly checkpointText: string;
}

export interface TallyChange {
  readonly row: TallyRow;
  readonly next: TallyNext;
}

export function tallyOf({ counts, stallsOn }: TallyDetails): string {
  return JSON.stringify({ counts, stallsOn: stallsOn ?? null });
}

function tallyRowOf(stored: typeof StoredTallySchema.Type): TallyRow {
  const { counts, stallsOn } = decodeKey(stored.tally);
  return {
    brain: stored.brain,
    tally: stored.tally,
    counts,
    stallsOn,
    saved: stored.saved,
    phase: stored.phase,
    checkpointText: stored.checkpoint,
    checkpoint: pointIn(stored.checkpoint),
    checkpointAt: stored.checkpoint_at,
    counted: stored.counted,
  };
}

export function talliesOf(database: HostDatabase, brain: string): Effect.Effect<readonly TallyRow[], DatabaseFailed> {
  const read = statement`SELECT brain, tally, saved, phase, checkpoint, checkpoint_at, counted FROM folder_tallies
    WHERE brain = ${brain} ORDER BY saved, tally`;
  return Effect.map(rowsOf(StoredTallySchema, database.read(read)), (rows) => rows.map((row) => tallyRowOf(row)));
}

function wantedOf({ functions }: BrainDefinitions): ReadonlyMap<string, number> {
  const wanted = new Map<string, number>();
  for (const { details, saved } of functions.values()) {
    for (const tally of Option.toArray(decodeDetails(details)).map((each) => tallyOf(each))) {
      wanted.set(tally, Math.min(saved, wanted.get(tally) ?? saved));
    }
  }
  return wanted;
}

function added(brain: string, tally: string, saved: number, phase: RowPhase): Statement {
  return statement`INSERT INTO folder_tallies (brain, tally, saved, phase, checkpoint, counted)
    VALUES (${brain}, ${tally}, ${saved}, ${phase}, '', 0) ON CONFLICT (brain, tally) DO NOTHING`;
}

function phased({ brain, tally }: TallyRow, phase: RowPhase): Statement {
  return statement`UPDATE folder_tallies SET phase = ${phase}
    WHERE brain = ${brain} AND tally = ${tally} AND phase IN ('waiting', 'rebuilding')`;
}

function dropped({ brain, tally }: TallyRow): readonly Statement[] {
  return [statement`DELETE FROM folder_tallies WHERE brain = ${brain} AND tally = ${tally}`];
}

function plannedTallies({ brain, definitions }: Reconciling, rows: readonly TallyRow[]): Reconciled<TallyRow> {
  const wanted = wantedOf(definitions);
  const known = new Set(rows.map(({ tally }) => tally));
  return {
    fresh: [...wanted]
      .filter(([tally]: readonly [string, number]) => !known.has(tally))
      .map(([tally, saved]: readonly [string, number]) => ({
        key: tally,
        saved,
        added: (phase: RowPhase) => added(brain, tally, saved, phase),
      })),
    dropped: rows.filter(({ tally }) => !wanted.has(tally)),
  };
}

function outputOf({ event }: PageEvent): unknown {
  return Reflect.get(new Object(event.data), 'output');
}

function endOf(row: TallyRow, page: ReadPage): Pick<TallyNext, 'checkpoint' | 'checkpointAt'> {
  const last = page.lastExamined;
  const moved = last !== undefined && comparePoints(last.point, row.checkpoint) > 0;
  return moved
    ? { checkpoint: last.point, checkpointAt: last.recordedAt }
    : { checkpoint: row.checkpoint, checkpointAt: row.checkpointAt };
}

function foldedTally(row: TallyRow, page: ReadPage): TallyChange {
  const considered = page.events.filter(
    ({ point, event }) => isAfter(point, row.checkpoint) && event.type === row.counts,
  );
  const stalling = considered.find((placed) => row.stallsOn !== null && outputOf(placed) === row.stallsOn);
  if (stalling === undefined) {
    return { row, next: { ...endOf(row, page), phase: row.phase, counted: row.counted + considered.length } };
  }
  const next: TallyNext = {
    checkpoint: stalling.point,
    checkpointAt: stalling.recordedAt,
    phase: 'stalled',
    counted: row.counted + considered.indexOf(stalling),
  };
  return { row, next };
}

function hasTallyChanged({ row, next }: TallyChange): boolean {
  return (
    next.phase !== row.phase || next.counted !== row.counted || comparePoints(next.checkpoint, row.checkpoint) !== 0
  );
}

function foldedTallies(rows: readonly TallyRow[], page: ReadPage): FoldedChanges<TallyChange> {
  const changes = rows.map((row) => foldedTally(row, page)).filter((change) => hasTallyChanged(change));
  return { changes, resting: [], complete: true, again: false };
}

function writtenTally(
  { database }: Writing,
  { row, next }: TallyChange,
): Effect.Effect<TallyRow | undefined, DatabaseFailed> {
  const write = statement`UPDATE folder_tallies SET phase = ${next.phase}, checkpoint = ${pointText(next.checkpoint)},
      checkpoint_at = ${next.checkpointAt}, counted = ${next.counted}
    WHERE brain = ${row.brain} AND tally = ${row.tally} AND checkpoint = ${row.checkpointText}
    RETURNING tally`;
  return Effect.map(rowsOf(TallyNameSchema, database.write(write)), (took) =>
    took.length === 0 ? undefined : { ...row, ...next, checkpointText: pointText(next.checkpoint) },
  );
}

export function tallyFolderOf(rebuildsAtOnce: number): Folder<TallyRow, TallyChange> {
  return {
    definitionType: tallyType,
    tables: [talliesTable],
    rebuildsAtOnce,
    keptOf: (details) => details,
    keyOf: ({ tally }) => tally,
    typesOf: ({ counts }) => [counts],
    brainsWithRows: (database) =>
      Effect.map(
        rowsOf(BrainSchema, database.read(statement`SELECT DISTINCT brain FROM folder_tallies ORDER BY brain`)),
        (rows) => rows.map(({ brain }) => brain),
      ),
    rowsOf: talliesOf,
    reconcile: plannedTallies,
    dropped,
    phased,
    fold: (rows, page) => Effect.succeed(foldedTallies(rows, page)),
    write: writtenTally,
    unchanged: (row) => ({
      row,
      next: { phase: row.phase, checkpoint: row.checkpoint, checkpointAt: row.checkpointAt, counted: row.counted },
    }),
    joinedLive: ({ row, next }) => ({ row, next: { ...next, phase: 'live' } }),
    hasChanged: hasTallyChanged,
  };
}
