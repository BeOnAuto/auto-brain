import { Conflict, type Decider } from '@beonauto/operations';
import { Result } from 'effect';

import type { RunCommand } from './run-commands.ts';
import { decideOnRun } from './run-decisions.ts';
import { RunEventSchema, type RunEvent } from './run-events.ts';
import { evolveRun, type RunStreamState } from './run-state.ts';

export const runDecider: Decider<RunStreamState, RunCommand, RunEvent, 'not_found' | 'conflict' | 'cancelled'> = {
  initialState: undefined,
  evolve: evolveRun,
  decide: decideOnRun,
  eventSchema: RunEventSchema,
};

interface RunAsRead {
  readonly state: RunStreamState;
  readonly version: number;
}

interface CommandAsRead {
  readonly readAt: number;
  readonly command: RunCommand;
}

export const changedSinceRead = new Conflict({
  detail: 'The run changed since it was read, so it is read again',
  kind: 'concurrent_change',
});

export const runDeciderAsRead: Decider<RunAsRead, CommandAsRead, RunEvent, 'not_found' | 'conflict' | 'cancelled'> = {
  initialState: { state: undefined, version: 0 },
  evolve: ({ state, version }, event) => ({ state: evolveRun(state, event), version: version + 1 }),
  decide: ({ readAt, command }, { state, version }) =>
    readAt === version ? decideOnRun(command, state) : Result.fail(changedSinceRead),
  eventSchema: RunEventSchema,
};

export function runStreamNameOf(id: string): string {
  return `runs/${id}`;
}
