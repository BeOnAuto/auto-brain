import { PlaybookContext, PlaybookWriter, Caller, noLineage, streamPrefixOfPlaybook } from '@beonauto/operations';
import { Effect } from 'effect';

import { toolTestIdKey } from '../calls/call-meta.ts';
import { ownCallJournal } from '../own-calls/own-call-journal.ts';
import { toolTestCalls } from './tool-test-decider.ts';
import { toolTestStreamOf } from './tool-test-events.ts';

const toolTestJournal = Effect.fnUntraced(function* (testId: string) {
  const writer = yield* PlaybookWriter;
  const stream = toolTestStreamOf(testId);
  const inThePlaybook = `${streamPrefixOfPlaybook(yield* PlaybookContext)}${stream}`;
  const { id: by } = yield* Caller;
  return ownCallJournal(toolTestCalls(testId), { writer, stream, inThePlaybook, by, lineage: noLineage });
});

export const toolTestContext = Effect.fnUntraced(function* (testId: string) {
  const { org, playbook } = yield* PlaybookContext;
  const journal = yield* toolTestJournal(testId);
  return { id: testId, org, playbook, journal, meta: { [toolTestIdKey]: testId } };
});
