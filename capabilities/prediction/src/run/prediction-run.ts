import { Buffer } from 'node:buffer';

import { seriesBounds, type CapabilityAnswer, type CapabilityRejection, type RunContext } from '@on.auto/definitions';
import { InvalidInput } from '@on.auto/operations';
import { measureOf, mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Effect, Predicate, Result, type Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isMapping } from '../document/checked-parts.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';

export type AskedRun = 'question' | 'build';

const tooDeep = new InvalidInput({
  detail: `The input nests more than the ${mostValueDepth} levels a prediction function takes`,
  issues: [{ pointer: '', detail: `Expected a value nested at most ${mostValueDepth} levels deep` }],
});

interface InputIssue {
  readonly pointer: string;
  readonly detail: string;
}

const { mostSeriesBytes } = predictionBounds;

export function askedRunOf(input: Schema.Json): AskedRun {
  return Predicate.isObject(input) && !Array.isArray(input) && Object.hasOwn(input, 'build') ? 'build' : 'question';
}

function seriesIssues(input: Schema.Json): readonly InputIssue[] {
  const series = isMapping(input) ? input['series'] : undefined;
  const bytes = typeof series === 'string' ? Buffer.byteLength(series, 'utf8') : 0;
  return bytes > mostSeriesBytes
    ? [{ pointer: '/series', detail: `Expected text of 1 to ${mostSeriesBytes} bytes in UTF-8, not ${bytes} bytes` }]
    : [];
}

export function issuesOfInput(
  { schemas }: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
  asked: AskedRun,
): readonly InputIssue[] {
  const checked = schemas[asked].validate(input);
  const schemaIssues = Result.isFailure(checked) ? checked.failure : [];
  return asked === 'question' ? [...schemaIssues, ...seriesIssues(input)] : schemaIssues;
}

function checkedInput(
  document: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
  asked: AskedRun,
): Effect.Effect<Schema.Json, InvalidInput> {
  if (measureOf(input) === undefined) {
    return Effect.fail(tooDeep);
  }
  const words =
    asked === 'build'
      ? 'The input is not a build, which is { build: {} }'
      : `The input is not a question this prediction function takes: a series, one of its horizons or none for every horizon, and none for a total, the given features it names, and at most ${seriesBounds.mostMarks} marks`;
  const issues = issuesOfInput(document, input, asked);
  return issues.length === 0 ? Effect.succeed(input) : Effect.fail(new InvalidInput({ detail: words, issues }));
}

export interface Asking {
  readonly build: (context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
  readonly question: (context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
}

export function predictionRun(
  document: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
  asking: Asking,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const asked = askedRunOf(input);
  return checkedInput(document, input, asked).pipe(Effect.andThen(() => asking[asked](context)));
}
