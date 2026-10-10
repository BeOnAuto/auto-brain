import { BrainContext, BrainWriter, Caller, noLineage, streamPrefixOfBrain } from '@beonauto/operations';
import { Effect } from 'effect';

import { toolTestIdKey } from '../calls/call-meta.ts';
import { ownCallJournal } from '../own-calls/own-call-journal.ts';
import { toolTestCalls } from './tool-test-decider.ts';
import { toolTestStreamOf } from './tool-test-events.ts';

const toolTestJournal = Effect.fnUntraced(function* (testId: string) {
  const writer = yield* BrainWriter;
  const stream = toolTestStreamOf(testId);
  const inTheBrain = `${streamPrefixOfBrain(yield* BrainContext)}${stream}`;
  const { id: by } = yield* Caller;
  return ownCallJournal(toolTestCalls(testId), { writer, stream, inTheBrain, by, lineage: noLineage });
});

export const toolTestContext = Effect.fnUntraced(function* (testId: string) {
  const { org, brain } = yield* BrainContext;
  const journal = yield* toolTestJournal(testId);
  return { id: testId, org, brain, journal, meta: { [toolTestIdKey]: testId } };
});
