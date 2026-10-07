import { BrainContext, BrainWriter, Caller, messageIdOf, streamPrefixOfBrain } from '@beonauto/operations';
import { DateTime, Effect, Exit, Ref, Semaphore } from 'effect';

import type { ToolCallFact } from '../execution/execution-commands.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { lastCallOf, runOf, type ExecutionState } from '../execution/execution-state.ts';
import type { RunLineage, ToolCallJournal } from '../primitive/primitive.ts';

export interface RunJournal extends ToolCallJournal {
  readonly latest: Effect.Effect<string>;
}

interface Calls {
  readonly answered: string;
  readonly started: ReadonlyMap<number, string>;
}

function causeOf(fact: ToolCallFact, calls: Calls): string {
  return fact.type === 'tool_call_answered' ? (calls.started.get(fact.number) ?? calls.answered) : calls.answered;
}

function numberOf(fact: ToolCallFact, state: ExecutionState): number {
  return fact.type === 'tool_call_answered' ? fact.number : lastCallOf(state);
}

function noted(fact: ToolCallFact, calls: Calls, number: number, id: string): Calls {
  return fact.type === 'tool_call_answered'
    ? { ...calls, answered: id }
    : { ...calls, started: new Map([...calls.started, [number, id]]) };
}

export const toolCallJournal = Effect.fnUntraced(function* (id: string, lineage: RunLineage) {
  const writer = yield* BrainWriter;
  const stream = `${streamPrefixOfBrain(yield* BrainContext)}${executionStreamOf(id)}`;
  const { id: by } = yield* Caller;
  const permit = yield* Semaphore.make(1);
  const calls = yield* Ref.make<Calls>({ answered: lineage.startId, started: new Map() });
  const append = (fact: ToolCallFact) =>
    permit.withPermits(1)(
      Effect.gen(function* () {
        const at = DateTime.formatIso(yield* DateTime.now);
        const known = yield* Ref.get(calls);
        const { state, version } = yield* writer.execute(
          executionStreamOf(id),
          executionDecider,
          { type: 'tool_call', fact, by, at },
          { causationId: causeOf(fact, known), correlationId: lineage.correlationId },
        );
        const number = numberOf(fact, runOf(state));
        yield* Ref.set(calls, noted(fact, known, number, messageIdOf(stream, version)));
        return number;
      }),
    );
  const journal: RunJournal = {
    started: (fact) => append(fact).pipe(Effect.catchCause(() => Effect.undefined)),
    answered: (fact) => append(fact).pipe(Effect.exit, Effect.map(Exit.isSuccess)),
    latest: Effect.map(Ref.get(calls), ({ answered }) => answered),
  };
  return journal;
});
