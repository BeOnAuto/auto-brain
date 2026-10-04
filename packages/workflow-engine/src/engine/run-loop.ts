import { decisionLoop, type Decided, type DecisionLoop } from '@beonauto/ledger';
import { Effect } from 'effect';

import { outcomeOf, staleReasonOf } from '../machine/admission.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import { loadedRunOf, type LoadedRun } from '../run-log/run-fold.ts';
import type { RunStore } from '../run-log/run-store.ts';
import type { Submission } from './workflow-engine.ts';

export type RunDecision = Decided<LoadedRun, RunState, RunEvent>;

export function runLoopOf(
  runStore: RunStore,
  decider: RunDecider,
): DecisionLoop<LoadedRun, RunState, RunInput, RunEvent, never> {
  return decisionLoop(
    (executionId: string) => Effect.map(runStore.load(executionId), (stored) => loadedRunOf(stored)),
    (executionId, events, expectedVersion) =>
      Effect.forEach(events, (event, index) => runStore.append(executionId, event, expectedVersion + index), {
        discard: true,
      }),
    decider,
  );
}

export function submissionOf({ events, loaded, version }: RunDecision, input: RunInput): Submission {
  return { outcome: events.length > 0 ? 'applied' : outcomeOf(staleReasonOf(loaded.state, input)), version };
}
