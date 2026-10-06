import { decisionLoop, type Decided, type DecisionLoop, type StreamAppend } from '@beonauto/ledger';
import { Data, Effect } from 'effect';

import { cachedLoadOf, keptAfter, runCacheOf, type RunCache } from '../cache/run-cache.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import type { LoadedRun } from '../run-log/run-fold.ts';
import type { RunStore } from '../run-log/run-store.ts';
import { recordLineageOf } from './record-lineage.ts';

export type RunDecision = Decided<LoadedRun, RunState, RunEvent>;

export class SplitDecision extends Data.TaggedError('split_decision')<{
  readonly executionId: string;
  readonly events: number;
}> {}

function appendOf(runStore: RunStore, cache: RunCache, input: RunInput): StreamAppend<RunEvent, LoadedRun> {
  return (executionId, events, expectedVersion, loaded) =>
    events.length > 1
      ? Effect.die(new SplitDecision({ executionId, events: events.length }))
      : Effect.forEach(
          events,
          (event) => runStore.append(executionId, event, expectedVersion, recordLineageOf(input, loaded.state, event)),
          { discard: true },
        ).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              cache.drop(executionId);
            }),
          ),
        );
}

export function runLoopOf(
  runStore: RunStore,
  decider: RunDecider,
  cache: RunCache = runCacheOf(),
): DecisionLoop<LoadedRun, RunState, RunInput, RunEvent, never> {
  const load = cachedLoadOf(runStore, cache);
  return (executionId, input) =>
    Effect.tap(decisionLoop(load, appendOf(runStore, cache, input), decider)(executionId, input), (decision) =>
      Effect.sync(() => {
        keptAfter(cache, executionId, decision);
      }),
    );
}
