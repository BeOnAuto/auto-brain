import { Data, Schema } from 'effect';

import { newRun, RunStateSchema, type RunState } from '../machine/run-state.ts';
import type { PositionedEvent, RunEvent } from './run-event.ts';
import type { StoredRun } from './run-store.ts';
import type { SinceSnapshot } from './snapshot.ts';
import { applyStatePatch } from './state-patch.ts';

export interface LoadedRun {
  readonly state: RunState;
  readonly version: number;
  readonly historyBytes: number;
  readonly sinceSnapshot: SinceSnapshot;
}

export class StreamGap extends Data.TaggedError('stream_gap')<{
  readonly expected: number;
  readonly found: number;
}> {}

interface FoldStart {
  readonly state: RunState;
  readonly version: number;
  readonly historyBytes: number;
  readonly snapshotBytes: number;
}

const decodeState = Schema.decodeUnknownSync(RunStateSchema);

export function evolveRun(state: RunState, event: RunEvent): RunState {
  return decodeState(applyStatePatch(state, event.patch));
}

function startOf({ snapshot }: StoredRun): FoldStart {
  return snapshot === null
    ? { state: newRun, version: 0, historyBytes: 0, snapshotBytes: 0 }
    : {
        state: snapshot.snapshot.state,
        version: snapshot.snapshot.version,
        historyBytes: snapshot.snapshot.historyBytes,
        snapshotBytes: snapshot.bytes,
      };
}

function requireContiguous(tail: readonly PositionedEvent[], after: number): void {
  for (const [index, { version }] of tail.entries()) {
    if (version !== after + index + 1) {
      throw new StreamGap({ expected: after + index + 1, found: version });
    }
  }
}

export function loadedRunOf(stored: StoredRun): LoadedRun {
  const start = startOf(stored);
  requireContiguous(stored.tail, start.version);
  const folded = stored.tail.reduce(
    (document: unknown, { event }: PositionedEvent) => applyStatePatch(document, event.patch),
    start.state,
  );
  const tailBytes = stored.tail.reduce((sum, { bytes }: PositionedEvent) => sum + bytes, 0);
  return {
    state: decodeState(folded),
    version: start.version + stored.tail.length,
    historyBytes: start.historyBytes + tailBytes,
    sinceSnapshot: { inputs: stored.tail.length, bytes: tailBytes, snapshotBytes: start.snapshotBytes },
  };
}
