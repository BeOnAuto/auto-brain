import { Schema } from 'effect';

import { RunStateSchema } from '../machine/run-state.ts';
import { StateFormatSchema } from './state-format.ts';

export const snapshotEveryInputs = 1000;

export const snapshotEveryBytes = 1_048_576;

export const mostSnapshotChunkBytes = 1_048_576;

export const SnapshotSchema = Schema.Struct({
  format: StateFormatSchema,
  executionId: Schema.NonEmptyString,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  historyBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  state: RunStateSchema,
});

export type Snapshot = typeof SnapshotSchema.Type;

export interface SinceSnapshot {
  readonly inputs: number;
  readonly bytes: number;
  readonly snapshotBytes: number;
}

const SnapshotTextSchema = Schema.fromJsonString(SnapshotSchema);

const encodeSnapshot = Schema.encodeSync(SnapshotTextSchema);

const decodeSnapshot = Schema.decodeUnknownResult(SnapshotTextSchema);

export function isSnapshotDue({ inputs, bytes, snapshotBytes }: SinceSnapshot): boolean {
  return inputs >= snapshotEveryInputs || bytes >= Math.max(snapshotEveryBytes, snapshotBytes);
}

function utf8LengthOf(codePoint: number): number {
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x8_00) {
    return 2;
  }
  return codePoint < 0x1_00_00 ? 3 : 4;
}

export function snapshotChunks(snapshot: Snapshot): readonly string[] {
  const text = encodeSnapshot(snapshot);
  const chunks: string[] = [];
  let start = 0;
  let end = 0;
  let bytes = 0;
  for (const character of text) {
    const length = utf8LengthOf(Number(character.codePointAt(0)));
    if (bytes + length > mostSnapshotChunkBytes) {
      chunks.push(text.slice(start, end));
      start = end;
      bytes = 0;
    }
    bytes += length;
    end += character.length;
  }
  chunks.push(text.slice(start));
  return chunks;
}

export function snapshotFromChunks(chunks: readonly string[]): ReturnType<typeof decodeSnapshot> {
  return decodeSnapshot(chunks.join(''));
}
