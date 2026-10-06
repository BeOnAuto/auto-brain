import { BrainWriter, Caller } from '@beonauto/operations';
import { DateTime, Effect, Exit, Semaphore } from 'effect';

import type { ToolCallFact } from '../execution/execution-commands.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import type { ToolCallJournal } from '../primitive/primitive.ts';

export const toolCallJournal = Effect.fnUntraced(function* (id: string) {
  const writer = yield* BrainWriter;
  const { id: by } = yield* Caller;
  const permit = yield* Semaphore.make(1);
  const append = (fact: ToolCallFact) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      return yield* writer.execute(executionStreamOf(id), executionDecider, { type: 'tool_call', fact, by, at });
    });
  const journal: ToolCallJournal = {
    record: (fact) => permit.withPermits(1)(append(fact)).pipe(Effect.exit, Effect.map(Exit.isSuccess)),
  };
  return journal;
});
