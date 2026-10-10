import { Struct } from 'effect';

import type { CallEnded } from '../calls/call-facts.ts';
import { ownCallDecider } from '../own-calls/own-call-decider.ts';
import type { OwnCallKind } from '../own-calls/own-call-journal.ts';
import { ToolTestEventSchema, type ToolTestEnded, type ToolTestEvent } from './tool-test-events.ts';

export const toolTestDecider = ownCallDecider<ToolTestEvent>({
  first: ['tool_test_started'],
  after: { tool_test_started: ['tool_test_answered', 'tool_test_failed'] },
  eventSchema: ToolTestEventSchema,
  outOfTurn: 'A test records its start once and then how it ended once, so this is not recorded',
});

function testEnded(testId: string, fact: CallEnded): ToolTestEnded {
  return fact.type === 'tool_call_answered'
    ? { type: 'tool_test_answered', data: { test_id: testId, ...fact.data } }
    : { type: 'tool_test_failed', data: { test_id: testId, ...fact.data } };
}

export function toolTestCalls(testId: string): OwnCallKind<ToolTestEvent> {
  return {
    decider: toolTestDecider,
    started: (fact) => ({
      type: 'tool_test_started',
      data: { test_id: testId, ...Struct.omit(fact, ['call_id']) },
    }),
    ended: (fact) => testEnded(testId, fact),
  };
}
