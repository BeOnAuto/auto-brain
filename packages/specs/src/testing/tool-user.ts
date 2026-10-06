import { Conflict, Unavailable } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import {
  definePrimitive,
  type Executed,
  type PrimitiveRejection,
  type Primitive,
  type ToolCallFact,
  type ToolCallJournal,
} from '../index.ts';

type Ending = 'succeed' | 'unavailable' | 'conflict' | 'stall';

export interface ToolUser {
  readonly primitive: Primitive;
  readonly stalled: Promise<void>;
  readonly recordedLate: () => Promise<readonly boolean[]>;
}

export function startOfCall(number: number): ToolCallFact {
  return {
    type: 'tool_call_started',
    number,
    call_id: `toolu_${number}`,
    server: 'graph',
    tool: 'search',
    arguments_bytes: 2,
    arguments_sha256: 'a'.repeat(64),
  };
}

export function answerOfCall(number: number): ToolCallFact {
  return {
    type: 'tool_call_answered',
    number,
    outcome: 'result',
    result_bytes: 2,
    result_sha256: 'b'.repeat(64),
    duration_ms: 5,
    jsonrpc_id: number,
  };
}

const decodeInput = Schema.decodeUnknownSync(
  Schema.Struct({
    calls: Schema.Int,
    ending: Schema.optionalKey(Schema.Literals(['succeed', 'unavailable', 'conflict', 'stall'])),
  }),
);

function everyCall(count: number, fact: (number: number) => ToolCallFact, journal: ToolCallJournal) {
  return Effect.forEach(
    Array.from({ length: count }, (_, index) => fact(index + 1)),
    (called) => journal.record(called),
    { concurrency: 'unbounded' },
  );
}

const endings: Readonly<
  Record<Exclude<Ending, 'stall'>, (recorded: readonly boolean[]) => Effect.Effect<Executed, PrimitiveRejection>>
> = {
  succeed: (recorded) => Effect.succeed({ output: { recorded: [...recorded] }, record: {} }),
  unavailable: () => Effect.fail(new Unavailable({ detail: 'The tools stopped answering' })),
  conflict: () => Effect.fail(new Conflict({ detail: 'The tools cannot run as written' })),
};

export function toolUser(): ToolUser {
  const journals: ToolCallJournal[] = [];
  const stalling = Promise.withResolvers<void>();
  const primitive = definePrimitive({
    name: 'tool-user',
    title: 'Tool user',
    description: 'Records the tool calls its input asks for, then ends as its input says.',
    noun: { one: 'tool user', other: 'tool users' },
    describeOutput: () => 'It called its tools.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    execute: (_document, input, { journal }) =>
      Effect.gen(function* () {
        journals.push(journal);
        const { calls, ending = 'succeed' } = decodeInput(input);
        const started = yield* everyCall(calls, startOfCall, journal);
        if (ending === 'stall') {
          stalling.resolve();
          return yield* Effect.never;
        }
        const answered = yield* everyCall(calls, answerOfCall, journal);
        return yield* endings[ending]([...started, ...answered]);
      }),
    reachesOutside: true,
    mayChangeOutside: true,
    callsTools: () => true,
  });
  return {
    primitive,
    stalled: stalling.promise,
    recordedLate: () => Promise.all(journals.map((journal) => Effect.runPromise(journal.record(answerOfCall(1))))),
  };
}
