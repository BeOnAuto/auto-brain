import { VersionConflict } from '@beonauto/ledger';
import { Effect, Result, Schema } from 'effect';

import { RunLogEventSchema, type PositionedEvent, type RunLogEvent } from '../run-log/run-event.ts';
import type { RecordLineage, RunLogStore, StoredSnapshot } from '../run-log/run-store.ts';
import { snapshotChunks, snapshotFromChunks, type Snapshot } from '../run-log/snapshot.ts';

type AppendFault = 'conflict' | 'unknown_outcome';

export interface MemoryRunStore extends RunLogStore {
  readonly events: (runId: string) => readonly PositionedEvent[];
  readonly lineages: (runId: string) => readonly RecordLineage[];
  readonly snapshotOf: (runId: string) => StoredSnapshot | null;
  readonly versions: () => ReadonlyMap<string, number>;
  readonly loads: (runId: string) => number;
  readonly snapshotsSaved: (runId: string) => readonly number[];
  readonly failNextAppend: (fault: AppendFault) => void;
}

const EventTextSchema = Schema.fromJsonString(Schema.toCodecJson(RunLogEventSchema));

const encodeEvent = Schema.encodeSync(EventTextSchema);

const decodeEvent = Schema.decodeUnknownSync(EventTextSchema);

const utf8 = new TextEncoder();

interface Streams {
  readonly eventsOf: (runId: string) => readonly PositionedEvent[];
  readonly lineagesOf: (runId: string) => readonly RecordLineage[];
  readonly push: (runId: string, event: RunLogEvent, lineage: RecordLineage) => void;
  readonly versions: () => ReadonlyMap<string, number>;
}

function streamsOf(): Streams {
  const streams = new Map<string, PositionedEvent[]>();
  const lineages = new Map<string, RecordLineage[]>();
  const eventsOf = (runId: string): readonly PositionedEvent[] => streams.get(runId) ?? [];
  return {
    eventsOf,
    lineagesOf: (runId) => lineages.get(runId) ?? [],
    push: (runId, event, lineage) => {
      const stream = streams.get(runId) ?? [];
      streams.set(runId, stream);
      stream.push({ version: stream.length + 1, event: decodeEvent(encodeEvent(event)) });
      lineages.set(runId, [...(lineages.get(runId) ?? []), lineage]);
    },
    versions: () =>
      new Map(
        [...streams].map(([runId, stream]: readonly [string, readonly PositionedEvent[]]) => [runId, stream.length]),
      ),
  };
}

interface Snapshots {
  readonly snapshotOf: (runId: string) => StoredSnapshot | null;
  readonly save: (snapshot: Snapshot) => void;
  readonly savedOf: (runId: string) => readonly number[];
}

function snapshotsOf(): Snapshots {
  const kept = new Map<string, StoredSnapshot>();
  const saved = new Map<string, readonly number[]>();
  const snapshotOf = (runId: string): StoredSnapshot | null => kept.get(runId) ?? null;
  return {
    snapshotOf,
    save: (snapshot) => {
      const { runId, version } = snapshot;
      saved.set(runId, [...(saved.get(runId) ?? []), version]);
      const chunks = snapshotChunks(snapshot);
      const bytes = chunks.reduce((sum, chunk) => sum + utf8.encode(chunk).byteLength, 0);
      const newest = snapshotOf(runId);
      if (newest === null || newest.snapshot.version < version) {
        kept.set(runId, { snapshot: Result.getOrThrow(snapshotFromChunks(chunks)), bytes });
      }
    },
    savedOf: (runId) => saved.get(runId) ?? [],
  };
}

const unknownOutcome = new Error('The store closed the connection before it answered');

export function memoryRunStore(conflicts = 0): MemoryRunStore {
  const streams = streamsOf();
  const snapshots = snapshotsOf();
  const loads = new Map<string, number>();
  const pending: { conflicts: number; fault: AppendFault | 'none' } = { conflicts, fault: 'none' };
  const appended = (
    runId: string,
    event: RunLogEvent,
    expectedVersion: number,
    lineage: RecordLineage,
  ): Effect.Effect<void, VersionConflict> => {
    const { fault } = pending;
    pending.conflicts -= 1;
    pending.fault = 'none';
    if (fault === 'conflict' || pending.conflicts >= 0 || streams.eventsOf(runId).length !== expectedVersion) {
      return Effect.fail(new VersionConflict());
    }
    streams.push(runId, event, lineage);
    return fault === 'unknown_outcome' ? Effect.die(unknownOutcome) : Effect.void;
  };
  return {
    load: (runId) =>
      Effect.sync(() => {
        loads.set(runId, (loads.get(runId) ?? 0) + 1);
        const snapshot = snapshots.snapshotOf(runId);
        return { snapshot, tail: streams.eventsOf(runId).slice(snapshot?.snapshot.version ?? 0) };
      }),
    append: (runId, event, expectedVersion, lineage) =>
      Effect.suspend(() => appended(runId, event, expectedVersion, lineage)),
    eventsAfter: (runId, version) => Effect.sync(() => streams.eventsOf(runId).slice(version)),
    saveSnapshot: (snapshot) =>
      Effect.sync(() => {
        snapshots.save(snapshot);
      }),
    events: (runId) => streams.eventsOf(runId).slice(),
    lineages: streams.lineagesOf,
    snapshotOf: snapshots.snapshotOf,
    versions: streams.versions,
    loads: (runId) => loads.get(runId) ?? 0,
    snapshotsSaved: snapshots.savedOf,
    failNextAppend: (fault) => {
      pending.fault = fault;
    },
  };
}
