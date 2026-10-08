import { Struct } from 'effect';

import { ownCallDecider } from '../own-calls/own-call-decider.ts';
import type { OwnCallKind } from '../own-calls/own-call-journal.ts';
import { ToolTestEventSchema, type ToolTestEvent } from './tool-test-events.ts';

export const toolTestDecider = ownCallDecider<ToolTestEvent>({
  first: ['tool_test_started'],
  after: { tool_test_started: 'tool_test_answered' },
  eventSchema: ToolTestEventSchema,
  outOfTurn: 'A test records its start once and then its answer once, so this is not recorded',
});

export function toolTestCalls(testId: string): OwnCallKind<ToolTestEvent> {
  return {
    decider: toolTestDecider,
    started: (fact, recorded) => ({
      type: 'tool_test_started',
      test_id: testId,
      ...Struct.omit(fact, ['type', 'call_id']),
      ...recorded,
    }),
    answered: (fact, recorded) => ({
      type: 'tool_test_answered',
      test_id: testId,
      ...Struct.omit(fact, ['type', 'number']),
      ...recorded,
    }),
  };
}
