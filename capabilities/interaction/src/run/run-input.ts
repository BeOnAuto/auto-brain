import { refusedInput, wordedIssuesOf } from '@on.auto/definitions';
import { InvalidInput } from '@on.auto/operations';
import { measureOf, mostValueDepth } from '@on.auto/workflow-engine/dsl';
import { Effect, type Schema } from 'effect';

import type { ValueContract } from '../document/interaction-document.ts';

const tooDeep = new InvalidInput({
  detail: `The input nests more than the ${mostValueDepth} levels an interaction function takes`,
  issues: [{ pointer: '', detail: `Expected a value nested at most ${mostValueDepth} levels deep` }],
});

export function preparedInput(input: Schema.Json, { schema }: ValueContract): Effect.Effect<Schema.Json, InvalidInput> {
  if (measureOf(input) === undefined) {
    return Effect.fail(tooDeep);
  }
  const issues = schema === undefined ? [] : wordedIssuesOf(schema, input);
  return issues.length === 0 ? Effect.succeed(input) : Effect.fail(refusedInput(issues));
}
