import { Schema } from 'effect';

import { RunStateSchema } from '../machine/run-state.ts';

export const snapshotEveryInputs = 1000;

export const snapshotEveryBytes = 1_048_576;

export const snapshotChunkLength = 65_536;

export const SnapshotSchema = Schema.Struct({
  format: Schema.Literal(1),
  executionId: Schema.NonEmptyString,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  state: RunStateSchema,
});

export type Snapshot = typeof SnapshotSchema.Type;

export interface SinceSnapshot {
  readonly inputs: number;
  readonly bytes: number;
}

const SnapshotTextSchema = Schema.fromJsonString(SnapshotSchema);

const encodeSnapshot = Schema.encodeSync(SnapshotTextSchema);

export const decodeSnapshot = Schema.decodeUnknownResult(SnapshotTextSchema);

export function isSnapshotDue({ inputs, bytes }: SinceSnapshot): boolean {
  return inputs >= snapshotEveryInputs || bytes >= snapshotEveryBytes;
}

const lastSingleUnitCodePoint = 0xff_ff;

function chunkEnd(text: string, start: number): number {
  const end = Math.min(start + snapshotChunkLength, text.length);
  const splitsAPair = Number(text.codePointAt(end - 1)) > lastSingleUnitCodePoint;
  return splitsAPair ? end - 1 : end;
}

export function snapshotChunks(snapshot: Snapshot): readonly string[] {
  const text = encodeSnapshot(snapshot);
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start = chunkEnd(text, start)) {
    chunks.push(text.slice(start, chunkEnd(text, start)));
  }
  return chunks;
}

export function snapshotFromChunks(chunks: readonly string[]): ReturnType<typeof decodeSnapshot> {
  return decodeSnapshot(chunks.join(''));
}
