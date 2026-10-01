import { readDuration } from '../dsl/durations.ts';
import { enclosedBody, expressionSource, runExpression, type Variables } from '../dsl/expressions.ts';
import { entriesOf, isList, isObject, isTruthy, type Json, type JsonEntry, type JsonObject } from '../dsl/json.ts';
import type { Invocation, Place } from './invocation.ts';
import { RaisedError, errorType, raised } from './raised-error.ts';

export function evaluate(source: string, data: Json, variables: Variables, place: Place): Json {
  const evaluation = runExpression(source, data, variables, place.now);
  if ('problem' in evaluation) {
    throw new RaisedError({
      type: errorType('expression'),
      status: 400,
      title: 'An expression failed',
      detail: evaluation.problem,
      instance: place.reference,
    });
  }
  return evaluation.value;
}

export function evaluateExpression(expression: string, data: Json, variables: Variables, place: Place): Json {
  return evaluate(expressionSource(expression), data, variables, place);
}

export function holds(condition: Json | undefined, data: Json, variables: Variables, place: Place): boolean {
  return typeof condition !== 'string' || isTruthy(evaluateExpression(condition, data, variables, place));
}

export function evaluateTemplate(template: Json, data: Json, variables: Variables, place: Place): Json {
  const body = enclosedBody(template);
  if (body !== undefined) {
    return evaluate(body, data, variables, place);
  }
  if (isList(template)) {
    return template.map((item) => evaluateTemplate(item, data, variables, place));
  }
  return isObject(template) ? evaluateObject(template, data, variables, place) : template;
}

export function transform(transformation: Json | undefined, data: Json, variables: Variables, place: Place): Json {
  if (transformation === undefined) {
    return data;
  }
  return typeof transformation === 'string'
    ? evaluateExpression(transformation, data, variables, place)
    : evaluateTemplate(transformation, data, variables, place);
}

export function millisecondsOf(duration: Json, data: Json, variables: Variables, place: Place): number {
  const reading = readDuration(evaluateTemplate(duration, data, variables, place));
  if ('problem' in reading) {
    throw raised('configuration', 400, `A duration of the task is not valid: ${reading.problem}`, place.reference);
  }
  return reading.milliseconds;
}

export function placeOf({ entry, scope }: Invocation): Place {
  return { reference: entry.reference, now: scope.state.host.now() };
}

function evaluateObject(template: JsonObject, data: Json, variables: Variables, place: Place): JsonObject {
  return Object.fromEntries(
    entriesOf(template).map(([key, value]: JsonEntry) => [key, evaluateTemplate(value, data, variables, place)]),
  );
}
