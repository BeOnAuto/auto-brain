import type { VersionConflict } from '@beonauto/ledger';
import type { Effect } from 'effect';

import type { PositionedEvent, RunEvent } from './run-event.ts';
import type { Snapshot } from './snapshot.ts';

export interface StoredSnapshot {
  readonly snapshot: Snapshot;
  readonly bytes: number;
}

export interface StoredRun {
  readonly snapshot: StoredSnapshot | null;
  readonly tail: readonly PositionedEvent[];
}

export interface RunStore {
  readonly load: (executionId: string) => Effect.Effect<StoredRun>;
  readonly append: (
    executionId: string,
    event: RunEvent,
    expectedVersion: number,
  ) => Effect.Effect<void, VersionConflict>;
  readonly eventsAfter: (executionId: string, version: number) => Effect.Effect<readonly PositionedEvent[]>;
  readonly saveSnapshot: (snapshot: Snapshot) => Effect.Effect<void>;
}
