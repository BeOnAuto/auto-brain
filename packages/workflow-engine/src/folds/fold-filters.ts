import { enclosedBody, runExpression } from '../dsl/expressions.ts';
import { entriesOf, field, isTruthy, jsonEquals, type Json, type JsonEntry, type JsonObject } from '../dsl/json.ts';
import { mostExpressionWork } from '../machine/limits.ts';

const noVariables = {};

function attributeMatches(expected: Json, actual: Json): boolean {
  const body = enclosedBody(expected);
  if (body === undefined) {
    return jsonEquals(expected, actual);
  }
  const evaluation = runExpression(body, actual, noVariables, { now: 0, mostWork: mostExpressionWork });
  return 'value' in evaluation && isTruthy(evaluation.value);
}

export function hasTheAttributes(filter: JsonObject, event: JsonObject): boolean {
  return (
    typeof field(filter, 'type') === 'string' &&
    entriesOf(filter).every(([name, expected]: JsonEntry) => attributeMatches(expected, field(event, name) ?? null))
  );
}
