import type { Decider } from '@beonauto/operations';

import type { ExecutionCommand } from './execution-commands.ts';
import { decideOnExecution } from './execution-decisions.ts';
import { ExecutionEventSchema, type ExecutionEvent } from './execution-events.ts';
import { evolveExecution, type ExecutionStreamState } from './execution-state.ts';

export const executionDecider: Decider<
  ExecutionStreamState,
  ExecutionCommand,
  ExecutionEvent,
  'not_found' | 'conflict' | 'cancelled'
> = {
  initialState: undefined,
  evolve: evolveExecution,
  decide: decideOnExecution,
  eventSchema: ExecutionEventSchema,
};

export function executionStreamOf(id: string): string {
  return `executions/${id}`;
}
