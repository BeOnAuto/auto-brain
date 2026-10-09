import { decisionLoop, type Decided, type DecisionLoop, type StreamAppend } from '@beonauto/ledger';
import { Data, Effect } from 'effect';

import { cachedLoadOf, keptAfter, runCacheOf, type RunCache } from '../cache/run-cache.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunLogEvent } from '../run-log/run-event.ts';
import type { LoadedRun } from '../run-log/run-fold.ts';
import type { RunLogStore } from '../run-log/run-store.ts';
import { recordLineageOf } from './record-lineage.ts';

export type RunDecision = Decided<LoadedRun, RunState, RunLogEvent>;

export class SplitDecision extends Data.TaggedError('split_decision')<{
  readonly runId: string;
  readonly events: number;
}> {}

function appendOf(runStore: RunLogStore, cache: RunCache, input: RunInput): StreamAppend<RunLogEvent, LoadedRun> {
  return (runId, events, expectedVersion, loaded) =>
    events.length > 1
      ? Effect.die(new SplitDecision({ runId, events: events.length }))
      : Effect.forEach(
          events,
          (event) => runStore.append(runId, event, expectedVersion, recordLineageOf(input, loaded.state, event)),
          { discard: true },
        ).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              cache.drop(runId);
            }),
          ),
        );
}

export function runLoopOf(
  runStore: RunLogStore,
  decider: RunDecider,
  cache: RunCache = runCacheOf(),
): DecisionLoop<LoadedRun, RunState, RunInput, RunLogEvent, never> {
  const load = cachedLoadOf(runStore, cache);
  return (runId, input) =>
    Effect.tap(decisionLoop(load, appendOf(runStore, cache, input), decider)(runId, input), (decision) =>
      Effect.sync(() => {
        keptAfter(cache, runId, decision);
      }),
    );
}
