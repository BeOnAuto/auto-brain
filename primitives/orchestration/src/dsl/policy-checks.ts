import { readDuration } from './durations.ts';
import { checkExpression, enclosedBody, expressionSource } from './expressions.ts';
import { entriesOf, field, isList, isObject, objectField, type Json, type JsonEntry, type JsonObject } from './json.ts';
import { pointerTo } from './tasks.ts';

export interface Rejection {
  readonly pointer: string;
  readonly detail: string;
  readonly forbidden: boolean;
}

export interface Components {
  readonly errors: JsonObject;
  readonly retries: JsonObject;
  readonly timeouts: JsonObject;
}

export type Located = readonly [Json | undefined, string];

export function rejection(pointer: string, detail: string): Rejection {
  return { pointer, detail, forbidden: false };
}

export function forbidden(pointer: string, detail: string): Rejection {
  return { pointer, detail, forbidden: true };
}

export function expressionRejections(expression: Json | undefined, pointer: string): readonly Rejection[] {
  if (typeof expression !== 'string') {
    return [];
  }
  const problem = checkExpression(expressionSource(expression));
  return problem === undefined ? [] : [rejection(pointer, problem)];
}

export function templateRejections(template: Json | undefined, pointer: string): readonly Rejection[] {
  if (enclosedBody(template) !== undefined) {
    return expressionRejections(template, pointer);
  }
  if (isList(template)) {
    return template.flatMap((item, index) => templateRejections(item, pointerTo(pointer, index)));
  }
  return isObject(template)
    ? entriesOf(template).flatMap(([key, value]: JsonEntry) => templateRejections(value, pointerTo(pointer, key)))
    : [];
}

export function transformRejections(transform: Json | undefined, pointer: string): readonly Rejection[] {
  return typeof transform === 'string'
    ? expressionRejections(transform, pointer)
    : templateRejections(transform, pointer);
}

export function durationRejections(duration: Json | undefined, pointer: string): readonly Rejection[] {
  if (duration === undefined) {
    return [];
  }
  if (enclosedBody(duration) !== undefined) {
    return expressionRejections(duration, pointer);
  }
  const reading = readDuration(duration);
  return 'problem' in reading ? [rejection(pointer, reading.problem)] : [];
}

export function timeoutRejections(
  timeout: Json | undefined,
  pointer: string,
  components: Components,
): readonly Rejection[] {
  if (typeof timeout === 'string') {
    return field(components.timeouts, timeout) === undefined
      ? [rejection(pointer, `use.timeouts has no timeout ${timeout}`)]
      : [];
  }
  return isObject(timeout) ? durationRejections(field(timeout, 'after'), `${pointer}/after`) : [];
}

export function retryPolicyRejections(policy: JsonObject, pointer: string): readonly Rejection[] {
  const limit = objectField(policy, 'limit') ?? {};
  const jitter = objectField(policy, 'jitter') ?? {};
  const durations: readonly Located[] = [
    [field(policy, 'delay'), `${pointer}/delay`],
    [field(jitter, 'from'), `${pointer}/jitter/from`],
    [field(jitter, 'to'), `${pointer}/jitter/to`],
    [field(limit, 'duration'), `${pointer}/limit/duration`],
    [field(objectField(limit, 'attempt') ?? {}, 'duration'), `${pointer}/limit/attempt/duration`],
  ];
  return expressionRejections(field(policy, 'when'), `${pointer}/when`).concat(
    expressionRejections(field(policy, 'exceptWhen'), `${pointer}/exceptWhen`),
    durations.flatMap(([duration, at]: Located) => durationRejections(duration, at)),
  );
}
