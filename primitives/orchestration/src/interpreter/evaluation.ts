import { readDuration } from '@beonauto/workflow-engine/dsl/durations';
import {
  enclosedBody,
  expressionSource,
  runExpression,
  type Variables,
} from '@beonauto/workflow-engine/dsl/expressions';
import {
  entriesOf,
  isList,
  isObject,
  isTruthy,
  type Json,
  type JsonEntry,
  type JsonObject,
} from '@beonauto/workflow-engine/dsl/json';
import { mostExpressionWork, mostWorkPerInput } from '@beonauto/workflow-engine/limits';

import type { Invocation, Place } from './invocation.ts';
import { RaisedError, errorType, raised } from './raised-error.ts';
import type { RunState } from './run-state.ts';

export function evaluate(source: string, data: Json, variables: Variables, place: Place): Json {
  const mostWork = place.meter.allowance();
  const evaluation = runExpression(source, data, variables, { now: place.now, mostWork });
  place.meter.record(evaluation.work);
  if ('value' in evaluation) {
    return evaluation.value;
  }
  if (evaluation.exhausted) {
    throw raised('runtime', 500, exhaustionOf(evaluation.problem, mostWork), place.reference);
  }
  throw new RaisedError({
    type: errorType('expression'),
    status: 400,
    title: 'An expression failed',
    detail: evaluation.problem,
    instance: place.reference,
  });
}

export function placeIn(state: RunState, reference: string): Place {
  return { reference, now: state.host.now(), meter: state.meter, mostDuration: state.run.mostDuration };
}

function exhaustionOf(problem: string, mostWork: number): string {
  return mostWork < mostExpressionWork
    ? `${problem}: the workflow did ${mostWorkPerInput} units of expression work in one activation; it lets other workflows run between tasks, not within one`
    : `${problem}: an expression may do ${mostExpressionWork} units of work`;
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
  if (reading.milliseconds > place.mostDuration) {
    throw raised(
      'configuration',
      400,
      `A duration of the task, ${reading.milliseconds} ms, is longer than the ${place.mostDuration} ms a workflow may run`,
      place.reference,
    );
  }
  return reading.milliseconds;
}

export function placeOf({ entry, scope }: Invocation): Place {
  return placeIn(scope.state, entry.reference);
}

function evaluateObject(template: JsonObject, data: Json, variables: Variables, place: Place): JsonObject {
  return Object.fromEntries(
    entriesOf(template).map(([key, value]: JsonEntry) => [key, evaluateTemplate(value, data, variables, place)]),
  );
}
