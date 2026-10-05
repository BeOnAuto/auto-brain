import { VersionConflict } from '@beonauto/ledger';
import { Effect, Result, Schema } from 'effect';

import { RunEventSchema, type PositionedEvent, type RunEvent } from '../run-log/run-event.ts';
import type { RunStore, StoredSnapshot } from '../run-log/run-store.ts';
import { snapshotChunks, snapshotFromChunks, type Snapshot } from '../run-log/snapshot.ts';

type AppendFault = 'conflict' | 'unknown_outcome';

export interface MemoryRunStore extends RunStore {
  readonly events: (executionId: string) => readonly PositionedEvent[];
  readonly snapshotOf: (executionId: string) => StoredSnapshot | null;
  readonly versions: () => ReadonlyMap<string, number>;
  readonly loads: (executionId: string) => number;
  readonly snapshotsSaved: (executionId: string) => readonly number[];
  readonly failNextAppend: (fault: AppendFault) => void;
}

const EventTextSchema = Schema.fromJsonString(Schema.toCodecJson(RunEventSchema));

const encodeEvent = Schema.encodeSync(EventTextSchema);

const decodeEvent = Schema.decodeUnknownSync(EventTextSchema);

const utf8 = new TextEncoder();

interface Streams {
  readonly eventsOf: (executionId: string) => readonly PositionedEvent[];
  readonly push: (executionId: string, event: RunEvent) => void;
  readonly versions: () => ReadonlyMap<string, number>;
}

function streamsOf(): Streams {
  const streams = new Map<string, PositionedEvent[]>();
  const eventsOf = (executionId: string): readonly PositionedEvent[] => streams.get(executionId) ?? [];
  return {
    eventsOf,
    push: (executionId, event) => {
      const stream = streams.get(executionId) ?? [];
      streams.set(executionId, stream);
      stream.push({ version: stream.length + 1, event: decodeEvent(encodeEvent(event)) });
    },
    versions: () =>
      new Map(
        [...streams].map(([executionId, stream]: readonly [string, readonly PositionedEvent[]]) => [
          executionId,
          stream.length,
        ]),
      ),
  };
}

interface Snapshots {
  readonly snapshotOf: (executionId: string) => StoredSnapshot | null;
  readonly save: (snapshot: Snapshot) => void;
  readonly savedOf: (executionId: string) => readonly number[];
}

function snapshotsOf(): Snapshots {
  const kept = new Map<string, StoredSnapshot>();
  const saved = new Map<string, readonly number[]>();
  const snapshotOf = (executionId: string): StoredSnapshot | null => kept.get(executionId) ?? null;
  return {
    snapshotOf,
    save: (snapshot) => {
      const { executionId, version } = snapshot;
      saved.set(executionId, [...(saved.get(executionId) ?? []), version]);
      const chunks = snapshotChunks(snapshot);
      const bytes = chunks.reduce((sum, chunk) => sum + utf8.encode(chunk).byteLength, 0);
      const newest = snapshotOf(executionId);
      if (newest === null || newest.snapshot.version < version) {
        kept.set(executionId, { snapshot: Result.getOrThrow(snapshotFromChunks(chunks)), bytes });
      }
    },
    savedOf: (executionId) => saved.get(executionId) ?? [],
  };
}

const unknownOutcome = new Error('The store closed the connection before it answered');

export function memoryRunStore(conflicts = 0): MemoryRunStore {
  const streams = streamsOf();
  const snapshots = snapshotsOf();
  const loads = new Map<string, number>();
  const pending: { conflicts: number; fault: AppendFault | 'none' } = { conflicts, fault: 'none' };
  const appended = (
    executionId: string,
    event: RunEvent,
    expectedVersion: number,
  ): Effect.Effect<void, VersionConflict> => {
    const { fault } = pending;
    pending.conflicts -= 1;
    pending.fault = 'none';
    if (fault === 'conflict' || pending.conflicts >= 0 || streams.eventsOf(executionId).length !== expectedVersion) {
      return Effect.fail(new VersionConflict());
    }
    streams.push(executionId, event);
    return fault === 'unknown_outcome' ? Effect.die(unknownOutcome) : Effect.void;
  };
  return {
    load: (executionId) =>
      Effect.sync(() => {
        loads.set(executionId, (loads.get(executionId) ?? 0) + 1);
        const snapshot = snapshots.snapshotOf(executionId);
        return { snapshot, tail: streams.eventsOf(executionId).slice(snapshot?.snapshot.version ?? 0) };
      }),
    append: (executionId, event, expectedVersion) =>
      Effect.suspend(() => appended(executionId, event, expectedVersion)),
    eventsAfter: (executionId, version) => Effect.sync(() => streams.eventsOf(executionId).slice(version)),
    saveSnapshot: (snapshot) =>
      Effect.sync(() => {
        snapshots.save(snapshot);
      }),
    events: (executionId) => streams.eventsOf(executionId).slice(),
    snapshotOf: snapshots.snapshotOf,
    versions: streams.versions,
    loads: (executionId) => loads.get(executionId) ?? 0,
    snapshotsSaved: snapshots.savedOf,
    failNextAppend: (fault) => {
      pending.fault = fault;
    },
  };
}
