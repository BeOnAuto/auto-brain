import type { Schema } from 'effect';

import { statement, type Statement } from '../database/statement.ts';
import { pointText } from './view-points.ts';
import type { FoldedEvent, ViewPhase, ViewRow, ViewStall } from './view-rows.ts';

export interface NewView {
  readonly brain: string;
  readonly name: string;
  readonly version: number;
  readonly saved: number;
  readonly details: string;
  readonly phase: ViewPhase;
  readonly view: string;
}

export interface FoldedRow {
  readonly view?: Schema.Json;
  readonly checkpoint: ViewRow['checkpoint'];
  readonly checkpointAt: string | null;
  readonly lastEvent: FoldedEvent | null;
  readonly folded: number;
  readonly overtimes: number;
  readonly phase: ViewPhase;
  readonly stall?: ViewStall;
}

export const viewsTable = statement`CREATE TABLE IF NOT EXISTS recall_views (
    brain TEXT NOT NULL,
    name TEXT NOT NULL,
    version BIGINT NOT NULL,
    saved BIGINT NOT NULL,
    details TEXT NOT NULL,
    phase TEXT NOT NULL,
    view TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    checkpoint_at TEXT,
    last_event_id TEXT,
    last_event_at TEXT,
    folded BIGINT NOT NULL,
    overtimes INTEGER NOT NULL,
    stalled_event_id TEXT,
    stalled_event_type TEXT,
    stalled_event_at TEXT,
    stalled_kind TEXT,
    stalled_message TEXT,
    stalled_line INTEGER,
    PRIMARY KEY (brain, name)
  )`;

export function viewsOfBrain(brain: string): Statement {
  return statement`SELECT brain, name, version, saved, details, phase, checkpoint, checkpoint_at, last_event_id,
      last_event_at, folded, overtimes, stalled_event_id, stalled_event_type, stalled_event_at, stalled_kind,
      stalled_message, stalled_line
    FROM recall_views WHERE brain = ${brain} ORDER BY saved, name`;
}

export function viewToFold({ brain, name, version, checkpointText }: ViewRow): Statement {
  return statement`SELECT view FROM recall_views
    WHERE brain = ${brain} AND name = ${name} AND version = ${version} AND checkpoint = ${checkpointText}`;
}

export function viewNamed(brain: string, name: string): Statement {
  return statement`SELECT * FROM recall_views WHERE brain = ${brain} AND name = ${name}`;
}

export const brainsWithViews = statement`SELECT DISTINCT brain FROM recall_views ORDER BY brain`;

export function viewAdded({ brain, name, version, saved, details, phase, view }: NewView): Statement {
  return statement`INSERT INTO recall_views (brain, name, version, saved, details, phase, view, checkpoint, folded, overtimes)
    VALUES (${brain}, ${name}, ${version}, ${saved}, ${details}, ${phase}, ${view}, '', 0, 0)
    ON CONFLICT (brain, name) DO NOTHING`;
}

export function viewRenewed({ brain, name, version, saved, details, phase, view }: NewView): Statement {
  return statement`UPDATE recall_views SET version = ${version}, saved = ${saved}, details = ${details},
      phase = ${phase}, view = ${view}, checkpoint = '', checkpoint_at = NULL, last_event_id = NULL,
      last_event_at = NULL, folded = 0, overtimes = 0, stalled_event_id = NULL, stalled_event_type = NULL,
      stalled_event_at = NULL, stalled_kind = NULL, stalled_message = NULL, stalled_line = NULL
    WHERE brain = ${brain} AND name = ${name} AND version < ${version}`;
}

export function viewDropped(brain: string, name: string): Statement {
  return statement`DELETE FROM recall_views WHERE brain = ${brain} AND name = ${name}`;
}

export function phaseSet({ brain, name, version }: ViewRow, phase: ViewPhase): Statement {
  return statement`UPDATE recall_views SET phase = ${phase}
    WHERE brain = ${brain} AND name = ${name} AND version = ${version} AND phase IN ('waiting', 'rebuilding')`;
}

const noLastEvent = { id: null, time: null };

const noStall = { id: null, type: null, time: null, kind: null, message: null, line: null };

function stallColumns(stall: ViewStall | undefined) {
  return stall === undefined ? noStall : { ...stall.event, kind: stall.kind, message: stall.message, line: stall.line };
}

function movedWritten(read: ViewRow, folded: FoldedRow): Statement {
  const lastEvent = folded.lastEvent ?? noLastEvent;
  const stall = stallColumns(folded.stall);
  return statement`UPDATE recall_views SET checkpoint = ${pointText(folded.checkpoint)},
      checkpoint_at = ${folded.checkpointAt}, last_event_id = ${lastEvent.id}, last_event_at = ${lastEvent.time},
      folded = ${folded.folded}, overtimes = ${folded.overtimes}, phase = ${folded.phase},
      stalled_event_id = ${stall.id}, stalled_event_type = ${stall.type}, stalled_event_at = ${stall.time},
      stalled_kind = ${stall.kind}, stalled_message = ${stall.message}, stalled_line = ${stall.line}
    WHERE brain = ${read.brain} AND name = ${read.name} AND version = ${read.version}
      AND checkpoint = ${read.checkpointText}
    RETURNING name`;
}

export function foldedWritten(read: ViewRow, folded: FoldedRow): Statement {
  if (folded.view === undefined) {
    return movedWritten(read, folded);
  }
  const lastEvent = folded.lastEvent ?? noLastEvent;
  const stall = stallColumns(folded.stall);
  return statement`UPDATE recall_views SET view = ${JSON.stringify(folded.view)}, checkpoint = ${pointText(folded.checkpoint)},
      checkpoint_at = ${folded.checkpointAt}, last_event_id = ${lastEvent.id}, last_event_at = ${lastEvent.time},
      folded = ${folded.folded}, overtimes = ${folded.overtimes}, phase = ${folded.phase},
      stalled_event_id = ${stall.id}, stalled_event_type = ${stall.type}, stalled_event_at = ${stall.time},
      stalled_kind = ${stall.kind}, stalled_message = ${stall.message}, stalled_line = ${stall.line}
    WHERE brain = ${read.brain} AND name = ${read.name} AND version = ${read.version}
      AND checkpoint = ${read.checkpointText}
    RETURNING name`;
}
