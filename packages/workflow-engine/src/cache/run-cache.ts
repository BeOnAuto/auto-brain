import { Effect } from 'effect';

import type { RunState } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import { loadedRunOf, type LoadedRun } from '../run-log/run-fold.ts';
import type { RunStore } from '../run-log/run-store.ts';
import { sinceSnapshotAfter } from '../run-log/snapshot.ts';

export interface RunCacheBounds {
  readonly mostRuns: number;
  readonly mostBytes: number;
}

export interface RunCache {
  readonly get: (executionId: string) => LoadedRun | undefined;
  readonly put: (executionId: string, loaded: LoadedRun) => void;
  readonly drop: (executionId: string) => void;
}

interface DecidedRun {
  readonly loaded: LoadedRun;
  readonly events: readonly RunEvent[];
  readonly state: RunState;
  readonly version: number;
}

export const runCacheBounds: RunCacheBounds = { mostRuns: 1024, mostBytes: 67_108_864 };

function bytesOf({ state }: LoadedRun): number {
  return state.heldBytes + state.inbox.waitingBytes;
}

export function runCacheOf({ mostRuns, mostBytes }: RunCacheBounds = runCacheBounds): RunCache {
  const runs = new Map<string, LoadedRun>();
  const held = { bytes: 0 };
  const drop = (executionId: string): void => {
    const kept = runs.get(executionId);
    if (kept !== undefined) {
      runs.delete(executionId);
      held.bytes -= bytesOf(kept);
    }
  };
  const evictLeastRecentlyUsed = (): void => {
    for (const executionId of runs.keys()) {
      if (runs.size <= mostRuns && held.bytes <= mostBytes) {
        return;
      }
      drop(executionId);
    }
  };
  return {
    get: (executionId) => {
      const kept = runs.get(executionId);
      if (kept !== undefined) {
        runs.delete(executionId);
        runs.set(executionId, kept);
      }
      return kept;
    },
    put: (executionId, loaded) => {
      drop(executionId);
      runs.set(executionId, loaded);
      held.bytes += bytesOf(loaded);
      evictLeastRecentlyUsed();
    },
    drop,
  };
}

function loadedFromStore(runStore: RunStore, cache: RunCache, executionId: string): Effect.Effect<LoadedRun> {
  return Effect.map(runStore.load(executionId), (stored) => {
    const loaded = loadedRunOf(stored);
    cache.put(executionId, loaded);
    return loaded;
  });
}

export function cachedLoadOf(runStore: RunStore, cache: RunCache): (executionId: string) => Effect.Effect<LoadedRun> {
  return (executionId) => {
    const kept = cache.get(executionId);
    if (kept === undefined) {
      return loadedFromStore(runStore, cache, executionId);
    }
    return Effect.flatMap(runStore.eventsAfter(executionId, kept.version), (newer) => {
      if (newer.length === 0) {
        return Effect.succeed(kept);
      }
      cache.drop(executionId);
      return loadedFromStore(runStore, cache, executionId);
    });
  };
}

export function keptAfter(cache: RunCache, executionId: string, decided: DecidedRun): void {
  if (decided.events.length > 0) {
    const sinceSnapshot = sinceSnapshotAfter(decided.loaded.sinceSnapshot, decided.events);
    cache.put(executionId, { state: decided.state, version: decided.version, sinceSnapshot });
  }
}
