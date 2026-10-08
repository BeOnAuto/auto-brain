import { BrainContext, BrainWriter, Caller, messageIdOf, streamPrefixOfBrain } from '@beonauto/operations';
import { DateTime, Effect, Exit, Ref, Struct } from 'effect';

import type { CallJournal } from '../calls/recorded-calls.ts';
import { toolTestDecider } from './tool-test-decider.ts';
import { toolTestStreamOf, type ToolTestEvent } from './tool-test-events.ts';

const theTestsOnlyCall = 1;

type Unrecorded<Event> = Event extends ToolTestEvent ? Omit<Event, 'by' | 'at'> : never;

export const toolTestJournal = Effect.fnUntraced(function* (testId: string) {
  const writer = yield* BrainWriter;
  const stream = toolTestStreamOf(testId);
  const inTheBrain = `${streamPrefixOfBrain(yield* BrainContext)}${stream}`;
  const { id: by } = yield* Caller;
  const startId = yield* Ref.make<string | null>(null);
  const appended = (fact: Unrecorded<ToolTestEvent>) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      const causationId = yield* Ref.get(startId);
      const { version } = yield* writer.execute(
        stream,
        toolTestDecider,
        { ...fact, by, at },
        { causationId, correlationId: null },
      );
      return messageIdOf(inTheBrain, version);
    });
  const journal: CallJournal = {
    started: (fact) =>
      appended({ type: 'tool_test_started', test_id: testId, ...Struct.omit(fact, ['type', 'call_id']) }).pipe(
        Effect.orDie,
        Effect.flatMap((id) => Ref.set(startId, id)),
        Effect.as(theTestsOnlyCall),
      ),
    answered: (fact) =>
      appended({ type: 'tool_test_answered', test_id: testId, ...Struct.omit(fact, ['type', 'number']) }).pipe(
        Effect.exit,
        Effect.map(Exit.isSuccess),
      ),
  };
  return journal;
});
