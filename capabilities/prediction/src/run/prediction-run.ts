import {
  refusedInput,
  wordedIssuesOf,
  type CapabilityAnswer,
  type CapabilityRejection,
  type RunContext,
} from '@on.auto/definitions';
import { InvalidInput } from '@on.auto/operations';
import { measureOf, mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Effect, Predicate, type Schema } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';

export type AskedRun = 'question' | 'build';

const tooDeep = new InvalidInput({
  detail: `The input nests more than the ${mostValueDepth} levels a prediction function takes`,
  issues: [{ pointer: '', detail: `Expected a value nested at most ${mostValueDepth} levels deep` }],
});

export function askedRunOf(input: Schema.Json): AskedRun {
  return Predicate.isObject(input) && !Array.isArray(input) && Object.hasOwn(input, 'build') ? 'build' : 'question';
}

function checkedInput(
  { schemas }: PredictionFunctionDefinitionDocument,
  input: Schema.Json,
  asked: AskedRun,
): Effect.Effect<Schema.Json, InvalidInput> {
  if (measureOf(input) === undefined) {
    return Effect.fail(tooDeep);
  }
  const issues = wordedIssuesOf(schemas[asked], input);
  return issues.length === 0 ? Effect.succeed(input) : Effect.fail(refusedInput(issues));
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
