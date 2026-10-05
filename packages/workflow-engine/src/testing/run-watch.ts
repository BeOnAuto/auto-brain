import { Effect } from 'effect';

import type { RunOutcome, RunState } from '../machine/run-state.ts';
import type { VirtualClock } from '../memory/virtual-clock.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import type { RunStore } from '../run-log/run-store.ts';

export interface RunWatch {
  readonly state: (executionId: string) => RunState;
  readonly runUntilEnded: (executionId: string) => RunState;
  readonly outcomeOf: (executionId: string) => Promise<RunOutcome>;
}

const mostClockSteps = 10_000;

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function endless(executionId: string, steps: number): Error {
  return new Error(`The run ${executionId} did not end within ${steps} steps of its clock`);
}

export function runWatchOf(runStore: RunStore, clock: VirtualClock, mostSteps = mostClockSteps): RunWatch {
  const state = (executionId: string): RunState => loadedRunOf(Effect.runSync(runStore.load(executionId))).state;
  const outcomeOf = async (executionId: string): Promise<RunOutcome> => {
    await nextTurn();
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
      for (let steps = 0; current.status !== 'ended' && clock.advance(); steps += 1) {
        if (steps === mostSteps) {
          throw endless(executionId, mostSteps);
        }
        current = state(executionId);
      }
      return current;
    },
    outcomeOf,
  };
}
