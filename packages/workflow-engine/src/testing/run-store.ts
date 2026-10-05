import { VersionConflict } from '@beonauto/ledger';
import { Effect, Result, Schema } from 'effect';

import { RunEventSchema, type PositionedEvent } from '../run-log/run-event.ts';
import type { RunStore, StoredSnapshot } from '../run-log/run-store.ts';
import { snapshotChunks, snapshotFromChunks } from '../run-log/snapshot.ts';

export interface MemoryRunStore extends RunStore {
  readonly events: (executionId: string) => readonly PositionedEvent[];
  readonly snapshotOf: (executionId: string) => StoredSnapshot | null;
}

const EventTextSchema = Schema.fromJsonString(Schema.toCodecJson(RunEventSchema));

const encodeEvent = Schema.encodeSync(EventTextSchema);

const decodeEvent = Schema.decodeUnknownSync(EventTextSchema);

const utf8 = new TextEncoder();

export function memoryRunStore(conflicts = 0): MemoryRunStore {
  const streams = new Map<string, readonly PositionedEvent[]>();
  const snapshots = new Map<string, StoredSnapshot>();
  const remaining = { conflicts };
  const eventsOf = (executionId: string): readonly PositionedEvent[] => streams.get(executionId) ?? [];
  const snapshotOf = (executionId: string): StoredSnapshot | null => snapshots.get(executionId) ?? null;
  return {
    load: (executionId) =>
      Effect.sync(() => {
        const snapshot = snapshotOf(executionId);
        return { snapshot, tail: eventsOf(executionId).slice(snapshot?.snapshot.version ?? 0) };
      }),
    append: (executionId, event, expectedVersion) =>
      Effect.suspend(() => {
        remaining.conflicts -= 1;
        if (remaining.conflicts >= 0 || eventsOf(executionId).length !== expectedVersion) {
          return Effect.fail(new VersionConflict());
        }
        const stored = { version: expectedVersion + 1, event: decodeEvent(encodeEvent(event)) };
        streams.set(executionId, [...eventsOf(executionId), stored]);
        return Effect.void;
      }),
    eventsAfter: (executionId, version) => Effect.sync(() => eventsOf(executionId).slice(version)),
    saveSnapshot: (snapshot) =>
      Effect.sync(() => {
        const chunks = snapshotChunks(snapshot);
        const bytes = chunks.reduce((sum, chunk) => sum + utf8.encode(chunk).byteLength, 0);
        snapshots.set(snapshot.executionId, { snapshot: Result.getOrThrow(snapshotFromChunks(chunks)), bytes });
      }),
    events: eventsOf,
    snapshotOf,
  };
}
