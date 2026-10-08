import { Conflict, type Decider } from '@beonauto/operations';
import { Result } from 'effect';

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

interface ExecutionAsRead {
  readonly state: ExecutionStreamState;
  readonly version: number;
}

interface CommandAsRead {
  readonly readAt: number;
  readonly command: ExecutionCommand;
}

export const changedSinceRead = new Conflict({
  detail: 'The run changed since it was read, so it is read again',
  kind: 'concurrent_change',
});

export const executionDeciderAsRead: Decider<
  ExecutionAsRead,
  CommandAsRead,
  ExecutionEvent,
  'not_found' | 'conflict' | 'cancelled'
> = {
  initialState: { state: undefined, version: 0 },
  evolve: ({ state, version }, event) => ({ state: evolveExecution(state, event), version: version + 1 }),
  decide: ({ readAt, command }, { state, version }) =>
    readAt === version ? decideOnExecution(command, state) : Result.fail(changedSinceRead),
  eventSchema: ExecutionEventSchema,
};

export function executionStreamOf(id: string): string {
  return `executions/${id}`;
}
