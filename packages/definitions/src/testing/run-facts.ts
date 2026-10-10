import type { Context, Recorded } from '@beonauto/operations';
import { Result } from 'effect';

import type { RunCommand } from '../runs/run-commands.ts';
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

export interface Ran {
  readonly state: RunStreamState;
  readonly recorded: readonly Recorded<RunEvent>[];
}

export const nothingRan: Ran = { state: runDecider.initialState, recorded: [] };

export function ranOnce({ state, recorded }: Ran, command: RunCommand): Ran {
  const decided = runDecider.decide(command, state);
  if (Result.isFailure(decided)) {
    return { state, recorded };
  }
  const context = runDecider.context(command, state);
  const facts = decided.success.map(recordedWith(context));
  return { state: runStateAfter([...recorded, ...facts]), recorded: [...recorded, ...facts] };
}

export function ranThrough(commands: readonly RunCommand[], from: Ran = nothingRan): Ran {
  let ran = from;
  for (const command of commands) {
    ran = ranOnce(ran, command);
  }
  return ran;
}
