import { Data, type Effect } from 'effect';

import type { RunState } from '../machine/run-state.ts';
import type { PositionedEvent, RunEvent } from './run-event.ts';
import type { SinceSnapshot, Snapshot } from './snapshot.ts';

export interface LoadedRun {
  readonly state: RunState;
  readonly version: number;
  readonly sinceSnapshot: SinceSnapshot;
}

export interface AppendedEvent {
  readonly version: number;
  readonly bytes: number;
}

export class VersionConflict extends Data.TaggedError('version_conflict')<{
  readonly executionId: string;
  readonly expectedVersion: number;
}> {}

export interface RunStore {
  readonly load: (executionId: string) => Effect.Effect<LoadedRun>;
  readonly append: (
    executionId: string,
    event: RunEvent,
    expectedVersion: number,
  ) => Effect.Effect<AppendedEvent, VersionConflict>;
  readonly eventsAfter: (executionId: string, version: number) => Effect.Effect<readonly PositionedEvent[]>;
  readonly saveSnapshot: (snapshot: Snapshot) => Effect.Effect<void>;
}
