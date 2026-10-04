import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { isSnapshotDue, snapshotChunkLength, snapshotChunks, snapshotFromChunks, type Snapshot } from '../index.ts';
import { executionId, runningState } from '../testing/runs.ts';

const highSurrogate = /[\uD800-\uDBFF]$/u;

const lowSurrogate = /^[\uDC00-\uDFFF]/u;

function snapshotHolding(text: string): Snapshot {
  return { format: 1, executionId, version: 4000, state: { ...runningState, machine: { context: text, root: null } } };
}

describe('a snapshot', () => {
  it('is due after 1,000 inputs or 1 MiB of history since the last one, whichever comes first', () => {
    expect([
      isSnapshotDue({ inputs: 999, bytes: 1_048_575 }),
      isSnapshotDue({ inputs: 1000, bytes: 0 }),
      isSnapshotDue({ inputs: 1, bytes: 1_048_576 }),
    ]).toEqual([false, true, true]);
  });

  it('round-trips a running state through its chunks', () => {
    const snapshot: Snapshot = { format: 1, executionId, version: 1000, state: runningState };

    expect(snapshotFromChunks(snapshotChunks(snapshot))).toEqual(Result.succeed(snapshot));
  });

  it('is stored in chunks of at most 65,536 UTF-16 code units that never split a character', () => {
    const snapshot = snapshotHolding(`${'😀'.repeat(70_000)}x${'😀'.repeat(70_000)}é`);

    const chunks = snapshotChunks(snapshot);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= snapshotChunkLength)).toBe(true);
    expect(chunks.filter((chunk) => highSurrogate.test(chunk))).toEqual([]);
    expect(chunks.filter((chunk) => lowSurrogate.test(chunk))).toEqual([]);
    expect(Math.max(...chunks.map((chunk) => new TextEncoder().encode(chunk).byteLength))).toBeLessThanOrEqual(196_608);
    expect(snapshotFromChunks(chunks)).toEqual(Result.succeed(snapshot));
  });

  it('is refused when its chunks do not make a snapshot of this format', () => {
    expect(Result.isFailure(snapshotFromChunks(['{"format":2}']))).toBe(true);
  });
});
