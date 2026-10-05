import { decisionLoop, type Decided, type DecisionLoop } from '@beonauto/ledger';
import { Data, Effect } from 'effect';

import { cachedLoadOf, keptAfter, runCacheOf, type RunCache } from '../cache/run-cache.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import type { LoadedRun } from '../run-log/run-fold.ts';
import type { RunStore } from '../run-log/run-store.ts';

export type RunDecision = Decided<LoadedRun, RunState, RunEvent>;

export class SplitDecision extends Data.TaggedError('split_decision')<{
  readonly executionId: string;
  readonly events: number;
}> {}

export function runLoopOf(
  runStore: RunStore,
  decider: RunDecider,
  cache: RunCache = runCacheOf(),
): DecisionLoop<LoadedRun, RunState, RunInput, RunEvent, never> {
  const loop = decisionLoop(
    cachedLoadOf(runStore, cache),
    (executionId, events, expectedVersion) =>
      events.length > 1
        ? Effect.die(new SplitDecision({ executionId, events: events.length }))
        : Effect.forEach(events, (event) => runStore.append(executionId, event, expectedVersion), {
            discard: true,
          }).pipe(
            Effect.onError(() =>
              Effect.sync(() => {
                cache.drop(executionId);
              }),
            ),
          ),
    decider,
  );
  return (executionId, input) =>
    Effect.tap(loop(executionId, input), (decision) =>
      Effect.sync(() => {
        keptAfter(cache, executionId, decision);
      }),
    );
}
