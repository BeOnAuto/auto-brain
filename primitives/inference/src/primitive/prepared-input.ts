import { InvalidInput } from '@beonauto/operations';
import { Effect, Predicate, Result, type Schema } from 'effect';

import type { InputContract } from '../spec/reasoning-function-definition.ts';

function isJsonObject(value: Schema.Json): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

const notAnObject = new InvalidInput({
  detail: 'The input of a reasoning function definition is a JSON object',
  issues: [{ pointer: '', detail: 'Expected a JSON object' }],
});

export function preparedInput(
  input: Schema.Json,
  { schema, defaults }: InputContract,
): Effect.Effect<Schema.JsonObject, InvalidInput> {
  if (!isJsonObject(input)) {
    return Effect.fail(notAnObject);
  }
  const merged: Schema.JsonObject = Object.fromEntries([...Object.entries(defaults), ...Object.entries(input)]);
  return schema === undefined
    ? Effect.succeed(merged)
    : Result.match(schema.validate(merged), {
        onSuccess: () => Effect.succeed(merged),
        onFailure: (issues) =>
          Effect.fail(
            new InvalidInput({ detail: 'The input does not match the reasoning function’s input schema', issues }),
          ),
      });
}
