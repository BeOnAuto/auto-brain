import { Schema } from 'effect';

import { RunStateSchema, type RunState } from '../machine/run-state.ts';
import {
  FormatsOneToSixSchema,
  SnapshotOfFormatsOneToSixSchema,
  snapshotNamesOfFormatsOneToSix,
} from './format-six-records.ts';
import { eventBytesOf, type RunLogEvent } from './run-event.ts';
import { stateFormat, ThisFormatOrNewerSchema, writtenInAnOlderFormat } from './state-format.ts';

export const snapshotEveryBytes = 1_048_576;

export const mostSnapshotChunkBytes = 1_048_576;

function snapshotInFormat<Format extends Schema.Top>(format: Format) {
  return Schema.Struct({
    format,
    runId: Schema.NonEmptyString,
    version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    historyBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    state: Schema.Json,
  });
}

export const SnapshotSchema = Schema.Union([
  snapshotInFormat(ThisFormatOrNewerSchema),
  writtenInAnOlderFormat(
    SnapshotOfFormatsOneToSixSchema,
    snapshotInFormat(FormatsOneToSixSchema),
    snapshotNamesOfFormatsOneToSix,
  ),
]);

export type Snapshot = typeof SnapshotSchema.Type;

export interface SinceSnapshot {
  readonly bytes: number;
  readonly snapshotBytes: number;
}

const SnapshotTextSchema = Schema.fromJsonString(SnapshotSchema);

const encodeSnapshot = Schema.encodeSync(SnapshotTextSchema);

const decodeSnapshot = Schema.decodeUnknownResult(SnapshotTextSchema);

const encodeState = Schema.encodeSync(Schema.toCodecJson(RunStateSchema));

const utf8 = new TextEncoder();

export function snapshotOf(state: RunState, version: number): Snapshot {
  return {
    format: stateFormat,
    runId: state.runId,
    version,
    historyBytes: state.historyBytes,
    state: encodeState(state),
  };
}

export function sinceSnapshotAfter(since: SinceSnapshot, events: readonly RunLogEvent[]): SinceSnapshot {
  return { ...since, bytes: events.reduce((sum, event) => sum + eventBytesOf(event), since.bytes) };
}

export function isSnapshotDue({ bytes, snapshotBytes }: SinceSnapshot): boolean {
  return bytes >= Math.max(snapshotEveryBytes, snapshotBytes);
}

export function snapshotChunks(snapshot: Snapshot): readonly string[] {
  const text = encodeSnapshot(snapshot);
  const buffer = new Uint8Array(mostSnapshotChunkBytes);
  const chunksFrom = (start: number): readonly string[] => {
    if (start >= text.length) {
      return [];
    }
    const { read } = utf8.encodeInto(text.slice(start), buffer);
    return [text.slice(start, start + read), ...chunksFrom(start + read)];
  };
  return chunksFrom(0);
}

export function snapshotFromChunks(chunks: readonly string[]): ReturnType<typeof decodeSnapshot> {
  return decodeSnapshot(chunks.join(''));
}
