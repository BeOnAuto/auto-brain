import { Conflict, InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect, Predicate, type Schema } from 'effect';

import { definePrimitive, type Executed, type RunContext, type Primitive, type PrimitiveRejection } from '../index.ts';

type Mishap = 'stall' | 'unavailable' | 'unoffered' | 'conflict' | 'unworkable' | 'breakdown' | 'spent' | 'overspent';

export const spentUsage = {
  input: { total: 120, uncached: 30, cache_read: 90, cache_write: 0 },
  output: { total: 40 },
};

export interface Probe {
  readonly primitive: Primitive;
  readonly runs: () => number;
  readonly sufferOnNextRun: (mishap: Mishap) => void;
  readonly stalled: Promise<void>;
  readonly rejectEveryDocument: () => void;
}

function linesOf(source: string, rejecting: boolean): Effect.Effect<readonly string[], InvalidInput> {
  const lines = source.split('\n');
  const issues = lines.flatMap((line, index) =>
    rejecting || line.includes('oops') ? [{ detail: `Line ${index + 1} is not accepted`, pointer: '' }] : [],
  );
  return issues.length === 0
    ? Effect.succeed(lines)
    : Effect.fail(new InvalidInput({ detail: 'The probe document has lines it does not accept', issues }));
}

const mishaps: Readonly<Record<Mishap, Effect.Effect<never, Unavailable | Conflict>>> = {
  stall: Effect.never,
  unavailable: Effect.fail(new Unavailable({ detail: 'The probe cannot answer now' })),
  unoffered: Effect.fail(
    new Unavailable({
      detail: 'The probe cannot reach that model, only others',
      kind: 'model_not_offered',
      because: 'provider_not_configured',
    }),
  ),
  conflict: Effect.fail(new Conflict({ detail: 'The probe cannot run this spec as written; update it' })),
  unworkable: Effect.fail(
    new Conflict({ detail: 'The program of the probe raised an error on line 2: stop', kind: 'unworkable' }),
  ),
  breakdown: Effect.die(new Error('The probe broke down')),
  spent: Effect.fail(
    new Unavailable({
      detail: 'The probe was answered, but not usably',
      record: { usage: spentUsage, duration_ms: 25 },
    }),
  ),
  overspent: Effect.fail(
    new Unavailable({ detail: 'The probe was answered at length', record: { answer: 'x'.repeat(1_048_577) } }),
  ),
};

function answerTo(input: Schema.Json, execution: RunContext, runs: number): Effect.Effect<Executed, InvalidInput> {
  if (Predicate.hasProperty(input, 'reject')) {
    return Effect.fail(
      new InvalidInput({
        detail: 'The probe rejects the input',
        issues: [{ detail: 'Expected anything but reject', pointer: '/reject' }],
      }),
    );
  }
  if (Predicate.hasProperty(input, 'unmeasurable')) {
    return Effect.succeed({ output: Number.NaN, record: {} });
  }
  if (Predicate.hasProperty(input, 'bulk') && Predicate.isNumber(input.bulk)) {
    return Effect.succeed({ output: 'x'.repeat(input.bulk), record: {} });
  }
  const { id, org, brain, caller, spec } = execution;
  return Effect.succeed({
    output: { input, execution: { id, org, brain, caller: { ...caller }, spec: { ...spec } } },
    record: { runs },
  });
}

export function probe(): Probe {
  let runs = 0;
  let nextMishap: Mishap | undefined;
  let rejecting = false;
  const stalling = Promise.withResolvers<void>();
  const primitive = definePrimitive({
    name: 'probe',
    title: 'Probe',
    description: 'Answers with its input and the execution it runs in. A spec document of probe is plain text.',
    noun: { one: 'probe', other: 'probes' },
    describeOutput: () => 'It answered.',
    mediaType: 'text/plain',
    parse: (source: string) => linesOf(source, rejecting),
    summarize: () => ({}),
    execute: (_lines, input, execution) =>
      Effect.suspend((): Effect.Effect<Executed, PrimitiveRejection> => {
        runs += 1;
        const mishap = nextMishap;
        nextMishap = undefined;
        if (mishap === 'stall') {
          stalling.resolve();
        }
        return mishap === undefined ? answerTo(input, execution, runs) : mishaps[mishap];
      }),
  });
  return {
    primitive,
    runs: () => runs,
    sufferOnNextRun: (mishap) => {
      nextMishap = mishap;
    },
    rejectEveryDocument: () => {
      rejecting = true;
    },
    stalled: stalling.promise,
  };
}
