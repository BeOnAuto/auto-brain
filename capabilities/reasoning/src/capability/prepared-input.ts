import { refusedInput, wordedIssuesOf } from '@on.auto/definitions';
import { InvalidInput } from '@on.auto/operations';
import { Effect, Predicate, type Schema } from 'effect';

import type { InputContract } from '../definition/reasoning-function-definition.ts';

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
  const issues = schema === undefined ? [] : wordedIssuesOf(schema, merged);
  return issues.length === 0 ? Effect.succeed(merged) : Effect.fail(refusedInput(issues));
}
