import type { Context, Recorded } from '@beonauto/operations';

import { runDecider } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import type { RunStreamState } from '../runs/run-state.ts';

export const testRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export function recordedWith(context: Context): (event: RunEvent) => Recorded<RunEvent> {
  return (event) => ({ ...event, context });
}

export function runStateAfter(recorded: readonly Recorded<RunEvent>[]): RunStreamState {
  let state = runDecider.initialState;
  for (const event of recorded) {
    state = runDecider.evolve(state, event);
  }
  return state;
}
