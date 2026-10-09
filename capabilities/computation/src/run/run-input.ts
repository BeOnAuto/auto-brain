import { InvalidInput } from '@beonauto/operations';
import { measureOf, mostValueDepth } from '@beonauto/workflow-engine/dsl';
import { Effect, Result, type Schema } from 'effect';

import type { ValueContract } from '../document/computation-document.ts';

const tooDeep = new InvalidInput({
  detail: `The input nests more than the ${mostValueDepth} levels a computation function takes`,
  issues: [{ pointer: '', detail: `Expected a value nested at most ${mostValueDepth} levels deep` }],
});

export function preparedInput(input: Schema.Json, { schema }: ValueContract): Effect.Effect<Schema.Json, InvalidInput> {
  if (measureOf(input) === undefined) {
    return Effect.fail(tooDeep);
  }
  return schema === undefined
    ? Effect.succeed(input)
    : Result.match(schema.validate(input), {
        onSuccess: () => Effect.succeed(input),
        onFailure: (issues) =>
          Effect.fail(
            new InvalidInput({ detail: 'The input does not match the computation function’s input schema', issues }),
          ),
      });
}
