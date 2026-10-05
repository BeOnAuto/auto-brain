import { setImmediate } from 'node:timers/promises';

import { Effect } from 'effect';

import type { RunOutcome, RunState } from '../machine/run-state.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import type { RunStore } from '../run-log/run-store.ts';
import type { VirtualClock } from './virtual-clock.ts';

export interface RunWatch {
  readonly state: (executionId: string) => RunState;
  readonly runUntilEnded: (executionId: string) => RunState;
  readonly outcomeOf: (executionId: string) => Promise<RunOutcome>;
}

export function runWatchOf(runStore: RunStore, clock: VirtualClock): RunWatch {
  const state = (executionId: string): RunState => loadedRunOf(Effect.runSync(runStore.load(executionId))).state;
  const outcomeOf = async (executionId: string): Promise<RunOutcome> => {
    await setImmediate();
    const { outcome } = state(executionId);
    if (outcome !== null) {
      return outcome;
    }
    if (!clock.advance()) {
      throw new Error(`The run ${executionId} waits for something that never comes`);
    }
    return outcomeOf(executionId);
  };
  return {
    state,
    runUntilEnded: (executionId) => {
      let current = state(executionId);
      while (current.status !== 'ended' && clock.advance()) {
        current = state(executionId);
      }
      return current;
    },
    outcomeOf,
  };
}
