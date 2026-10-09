import { Result } from 'effect';

import type { RunDecider } from '../machine/run-decider.ts';
import { newRun } from '../machine/run-state.ts';
import { RunLogEventSchema } from '../run-log/run-event.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { deciding } from './deciding.ts';
import { decided } from './decision.ts';

export function workflowMachine(options: MachineOptions): RunDecider {
  return {
    initialState: newRun,
    evolve: evolveRun,
    eventSchema: RunLogEventSchema,
    decide: (input, state) => Result.succeed(deciding(options, (withUnit) => decided(withUnit, input, state))),
  };
}
