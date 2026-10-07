import { Conflict, Unavailable } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import {
  definePrimitive,
  type Executed,
  type CallAnsweredFact,
  type CallStartedFact,
  type PrimitiveRejection,
  type Primitive,
  type ToolCallJournal,
} from '../index.ts';

type Ending = 'succeed' | 'unavailable' | 'conflict' | 'stall';

export interface ToolUser {
  readonly primitive: Primitive;
  readonly stalled: Promise<void>;
  readonly recordedLate: () => Promise<readonly boolean[]>;
  readonly startedLate: () => Promise<readonly (number | undefined)[]>;
}

export function startOfCall(number: number): CallStartedFact {
  return {
    type: 'tool_call_started',
    call_id: `toolu_${number}`,
    server: 'graph',
    tool: 'search',
    arguments_bytes: 2,
    arguments_sha256: 'a'.repeat(64),
  };
}

export function answerOfCall(number: number): CallAnsweredFact {
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

function numbersUpTo(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function everyStart(count: number, journal: ToolCallJournal) {
  return Effect.forEach(
    numbersUpTo(count),
    (number) => Effect.map(journal.started(startOfCall(number)), (assigned) => assigned !== undefined),
    { concurrency: 'unbounded' },
  );
}

function everyAnswer(count: number, journal: ToolCallJournal) {
  return Effect.forEach(numbersUpTo(count), (number) => journal.answered(answerOfCall(number)), {
    concurrency: 'unbounded',
  });
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
    guide: { name: 'tool-user' },
    noun: { one: 'tool user', other: 'tool users' },
    describeOutput: () => 'It called its tools.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    execute: (_document, input, { journal }) =>
      Effect.gen(function* () {
        journals.push(journal);
        const { calls, ending = 'succeed' } = decodeInput(input);
        const started = yield* everyStart(calls, journal);
        if (ending === 'stall') {
          stalling.resolve();
          return yield* Effect.never;
        }
        const answered = yield* everyAnswer(calls, journal);
        return yield* endings[ending]([...started, ...answered]);
      }),
    reachesOutside: true,
    mayChangeOutside: true,
    callsTools: () => true,
  });
  return {
    primitive,
    stalled: stalling.promise,
    recordedLate: () => Promise.all(journals.map((journal) => Effect.runPromise(journal.answered(answerOfCall(1))))),
    startedLate: () => Promise.all(journals.map((journal) => Effect.runPromise(journal.started(startOfCall(9))))),
  };
}
