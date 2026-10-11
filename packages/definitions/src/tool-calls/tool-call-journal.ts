import type { CallEnded } from '@beonauto/mcp';
import { BrainContext, BrainWriter, Caller, messageIdOf, streamPrefixOfBrain } from '@beonauto/operations';
import { DateTime, Effect, Exit, Ref, Semaphore } from 'effect';

import type { RunLineage, ToolCallJournal } from '../capability/capability.ts';
import type { ToolCallFact } from '../runs/run-commands.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { lastCallOf, startedRunOf, type RunState } from '../runs/run-state.ts';

export interface RunJournal extends ToolCallJournal {
  readonly latest: Effect.Effect<string>;
}

interface Calls {
  readonly answered: string;
  readonly started: ReadonlyMap<number, string>;
}

function causeOf(fact: ToolCallFact, calls: Calls): string {
  return fact.type === 'tool_call_started' ? calls.answered : (calls.started.get(fact.data.number) ?? calls.answered);
}

function numberOf(fact: ToolCallFact, state: RunState): number {
  return fact.type === 'tool_call_started' ? lastCallOf(state) : fact.data.number;
}

function noted(fact: ToolCallFact, calls: Calls, number: number, id: string): Calls {
  return fact.type === 'tool_call_started'
    ? { ...calls, started: new Map([...calls.started, [number, id]]) }
    : { ...calls, answered: id };
}

function endedFact(number: number, fact: CallEnded): ToolCallFact {
  return fact.type === 'tool_call_answered'
    ? { type: fact.type, data: { number, ...fact.data } }
    : { type: fact.type, data: { number, ...fact.data } };
}

export const toolCallJournal = Effect.fnUntraced(function* (id: string, lineage: RunLineage) {
  const writer = yield* BrainWriter;
  const stream = `${streamPrefixOfBrain(yield* BrainContext)}${runStreamNameOf(id)}`;
  const { id: by } = yield* Caller;
  const permit = yield* Semaphore.make(1);
  const calls = yield* Ref.make<Calls>({ answered: lineage.startId, started: new Map() });
  const append = (fact: ToolCallFact) =>
    permit.withPermits(1)(
      Effect.gen(function* () {
        const at = DateTime.formatIso(yield* DateTime.now);
        const known = yield* Ref.get(calls);
        const { state, version } = yield* writer.execute(
          runStreamNameOf(id),
          runDecider,
          { type: 'tool_call', fact, runId: id, by, at },
          { causationId: causeOf(fact, known), correlationId: lineage.correlationId },
        );
        const number = numberOf(fact, startedRunOf(state));
        yield* Ref.set(calls, noted(fact, known, number, messageIdOf(stream, version)));
        return number;
      }),
    );
  const journal: RunJournal = {
    started: (data) => append({ type: 'tool_call_started', data }).pipe(Effect.catchCause(() => Effect.undefined)),
    ended: (number, fact) => append(endedFact(number, fact)).pipe(Effect.exit, Effect.map(Exit.isSuccess)),
    latest: Effect.map(Ref.get(calls), ({ answered }) => answered),
  };
  return journal;
});
