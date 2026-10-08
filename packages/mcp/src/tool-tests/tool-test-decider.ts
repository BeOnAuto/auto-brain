import { Conflict, type Decider } from '@beonauto/operations';
import { Result } from 'effect';

import { ToolTestEventSchema, type ToolTestEvent } from './tool-test-events.ts';

type ToolTestState = 'none' | ToolTestEvent['type'];

const nextOf: Readonly<Record<ToolTestState, ToolTestEvent['type'] | undefined>> = {
  none: 'tool_test_started',
  tool_test_started: 'tool_test_answered',
  tool_test_answered: undefined,
};

const outOfTurn = new Conflict({
  detail: 'A test records its start once and then its answer once, so this is not recorded',
});

export const toolTestDecider: Decider<ToolTestState, ToolTestEvent, ToolTestEvent, 'conflict'> = {
  initialState: 'none',
  evolve: (_state, event) => event.type,
  decide: (event, state) => (nextOf[state] === event.type ? Result.succeed([event]) : Result.fail(outOfTurn)),
  eventSchema: ToolTestEventSchema,
};
