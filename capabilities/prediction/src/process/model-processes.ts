import { availableParallelism } from 'node:os';

import type { ProcessOutcome, ProcessPool, ProcessValue } from '@on.auto/workflow-engine/dsl';
import { Effect, Option, Schema } from 'effect';

import { TensorSchema } from '../facts/build-facts.ts';
import type { Fed, WalkJob } from './model-feeds.ts';

export interface ModelDeadlines {
  readonly check: number;
  readonly run: number;
  readonly walk: number;
}

export const modelDeadlines: ModelDeadlines = { check: 30_000, run: 10_000, walk: 600_000 };

export const modelProcessModule = new URL('./model-process.ts', import.meta.url);

const Floats = Schema.declare((value: unknown): value is Readonly<Float32Array> => value instanceof Float32Array);

const SignatureSchema = Schema.Union([
  Schema.Struct({
    loaded: Schema.Literal(true),
    inputs: Schema.Array(TensorSchema),
    outputs: Schema.Array(TensorSchema),
    opset: Schema.Int,
  }),
  Schema.Struct({ loaded: Schema.Literal(false), detail: Schema.String }),
]);

const BadlySchema = Schema.Struct({ badly: Schema.String });

const QuestionAnswerSchema = Schema.Struct({ q: Floats, dims: Schema.Array(Schema.Int) });

const WalkAnswerSchema = Schema.Struct({ series: Schema.Array(Schema.String), q: Schema.Array(Floats) });

export type Signature = typeof SignatureSchema.Type;

type QuestionAnswer = typeof QuestionAnswerSchema.Type;

export type WalkAnswer = typeof WalkAnswerSchema.Type;

type Interrupted = Exclude<ProcessOutcome['ended'], 'answered' | 'crashed'>;

export type ModelOutcome<Answer> = { readonly milliseconds: number } & (
  | { readonly ended: 'answered'; readonly answer: Answer }
  | { readonly ended: 'badly' | 'crashed'; readonly detail: string }
  | { readonly ended: Interrupted }
);

interface ModelFile {
  readonly sha256: string;
  readonly path: string;
}

type Walk = Omit<WalkJob, 'model' | 'threads'>;

export interface ModelProcesses {
  readonly check: (model: ModelFile) => Effect.Effect<ModelOutcome<Signature>>;
  readonly run: (model: ModelFile, question: Fed) => Effect.Effect<ModelOutcome<QuestionAnswer>>;
  readonly walk: (model: ModelFile, walk: Walk) => Effect.Effect<ModelOutcome<WalkAnswer>>;
}

export interface ModelProcessSettings {
  readonly pool: ProcessPool;
  readonly module?: Readonly<URL>;
  readonly deadlines?: ModelDeadlines;
}

const decodeBadly = Schema.decodeUnknownOption(BadlySchema);

function outcomeOf<Answer>(
  outcome: ProcessOutcome,
  decode: (answer: unknown) => Option.Option<Answer>,
): ModelOutcome<Answer> {
  const { milliseconds } = outcome;
  if (outcome.ended !== 'answered') {
    return outcome;
  }
  const badly = decodeBadly(outcome.answer);
  if (Option.isSome(badly)) {
    return { ended: 'badly', detail: badly.value.badly, milliseconds };
  }
  return Option.match(decode(outcome.answer), {
    onNone: () => ({
      ended: 'crashed',
      detail: 'The model process answered what a model process does not',
      milliseconds,
    }),
    onSome: (answer) => ({ ended: 'answered', answer, milliseconds }),
  });
}

export function threadsOf(processes: number, cores = availableParallelism()): number {
  return Math.max(1, Math.floor(cores / processes));
}

export function modelProcesses({
  pool,
  module = modelProcessModule,
  deadlines = modelDeadlines,
}: ModelProcessSettings): ModelProcesses {
  const threads = threadsOf(pool.processes);
  const asked = <Answer>(
    model: ModelFile,
    kind: keyof ModelDeadlines,
    payload: { readonly [name: string]: ProcessValue },
    decode: (answer: unknown) => Option.Option<Answer>,
  ): Effect.Effect<ModelOutcome<Answer>> =>
    Effect.map(
      Effect.promise(() =>
        pool.run({
          module,
          key: model.sha256,
          kind,
          payload: { ...payload, model: model.path, threads },
          deadlineMs: deadlines[kind],
          long: kind === 'walk',
        }),
      ),
      (outcome) => outcomeOf(outcome, decode),
    );
  return {
    check: (model) => asked(model, 'check', {}, Schema.decodeUnknownOption(SignatureSchema)),
    run: (model, question) => asked(model, 'run', { ...question }, Schema.decodeUnknownOption(QuestionAnswerSchema)),
    walk: (model, walk) => asked(model, 'walk', { ...walk }, Schema.decodeUnknownOption(WalkAnswerSchema)),
  };
}
