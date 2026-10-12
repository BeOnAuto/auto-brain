import { Buffer } from 'node:buffer';

import type { CapabilityAnswer, CapabilityRejection } from '@on.auto/definitions';
import { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
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

const noActiveVersion = new Conflict({
  detail: 'The function has no active version yet, and this runtime does not offer a build yet',
  kind: 'no_active_version',
});

const buildsNotOffered = new Unavailable({
  detail:
    'This runtime does not offer builds of a prediction function yet, so no version can be built; its dataset is kept meanwhile, as get_definition shows',
  kind: 'build_not_offered',
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
      : 'The input is not a question this prediction function takes: a series, one of its horizons and the given features it names';
  const issues = issuesOfInput(document, input, asked);
  return issues.length === 0 ? Effect.succeed(input) : Effect.fail(new InvalidInput({ detail: words, issues }));
}

export function predictionRun(
  document: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const asked = askedRunOf(input);
  return checkedInput(document, input, asked).pipe(
    Effect.andThen(() => Effect.fail(asked === 'build' ? buildsNotOffered : noActiveVersion)),
  );
}
