import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  isSnapshotDue,
  mostSnapshotChunkBytes,
  snapshotChunks,
  snapshotFromChunks,
  stateFormat,
  type Snapshot,
} from '../index.ts';
import { executionId, runningState } from '../testing/runs.ts';

const highSurrogate = /[\uD800-\uDBFF]$/u;

const lowSurrogate = /^[\uDC00-\uDFFF]/u;

const utf8 = new TextEncoder();

function snapshotHolding(text: string): Snapshot {
  const values = { ...runningState.machine.values, 0: { value: text, bytes: text.length, holders: 1 } };
  return {
    format: stateFormat,
    executionId,
    version: 4000,
    historyBytes: 9_000_000,
    state: { ...runningState, machine: { ...runningState.machine, values } },
  };
}

describe('a snapshot', () => {
  it('is due after 1,000 inputs, or after as many bytes of events as the last snapshot took, and at least 1 MiB', () => {
    expect([
      isSnapshotDue({ inputs: 999, bytes: 1_048_575, snapshotBytes: 0 }),
      isSnapshotDue({ inputs: 1000, bytes: 0, snapshotBytes: 0 }),
      isSnapshotDue({ inputs: 1, bytes: 1_048_576, snapshotBytes: 900_000 }),
      isSnapshotDue({ inputs: 1, bytes: 2_000_000, snapshotBytes: 3_000_000 }),
      isSnapshotDue({ inputs: 1, bytes: 3_000_000, snapshotBytes: 3_000_000 }),
    ]).toEqual([false, true, true, false, true]);
  });

  it('round-trips a running state through its chunks, with the bytes of history it covers', () => {
    const snapshot: Snapshot = {
      format: stateFormat,
      executionId,
      version: 1000,
      historyBytes: 2_100_000,
      state: runningState,
    };

    expect(snapshotFromChunks(snapshotChunks(snapshot))).toEqual(Result.succeed(snapshot));
  });

  it('is stored in chunks of at most 1 MiB of UTF-8, well under the 2 MB a row takes, that never split a character', () => {
    const snapshot = snapshotHolding(`${'😀'.repeat(300_000)}x${'€'.repeat(200_000)}é${'é'.repeat(300_000)}`);

    const chunks = snapshotChunks(snapshot);

    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map((chunk) => utf8.encode(chunk).byteLength))).toBeLessThanOrEqual(
      mostSnapshotChunkBytes,
    );
    expect(chunks.filter((chunk) => highSurrogate.test(chunk))).toEqual([]);
    expect(chunks.filter((chunk) => lowSurrogate.test(chunk))).toEqual([]);
    expect(snapshotFromChunks(chunks)).toEqual(Result.succeed(snapshot));
  });

  it('is refused when its chunks do not make a snapshot of this state format', () => {
    const snapshot: Snapshot = { format: stateFormat, executionId, version: 1, historyBytes: 10, state: runningState };
    const text = snapshotChunks(snapshot)
      .join('')
      .replace(`"format":${stateFormat}`, `"format":${stateFormat + 1}`);

    expect(Result.isFailure(snapshotFromChunks([text]))).toBe(true);
  });
});
