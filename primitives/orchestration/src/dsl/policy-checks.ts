import { readDuration } from './durations.ts';
import { checkExpression, enclosedBody, expressionSource } from './expressions.ts';
import { entriesOf, field, isList, isObject, objectField, type Json, type JsonEntry, type JsonObject } from './json.ts';
import { pointerTo } from './tasks.ts';

export interface Refusal {
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

export function refusal(pointer: string, detail: string): Refusal {
  return { pointer, detail, forbidden: false };
}

export function forbidden(pointer: string, detail: string): Refusal {
  return { pointer, detail, forbidden: true };
}

export function expressionRefusals(expression: Json | undefined, pointer: string): readonly Refusal[] {
  if (typeof expression !== 'string') {
    return [];
  }
  const problem = checkExpression(expressionSource(expression));
  return problem === undefined ? [] : [refusal(pointer, problem)];
}

export function templateRefusals(template: Json | undefined, pointer: string): readonly Refusal[] {
  if (enclosedBody(template) !== undefined) {
    return expressionRefusals(template, pointer);
  }
  if (isList(template)) {
    return template.flatMap((item, index) => templateRefusals(item, pointerTo(pointer, index)));
  }
  return isObject(template)
    ? entriesOf(template).flatMap(([key, value]: JsonEntry) => templateRefusals(value, pointerTo(pointer, key)))
    : [];
}

export function transformRefusals(transform: Json | undefined, pointer: string): readonly Refusal[] {
  return typeof transform === 'string' ? expressionRefusals(transform, pointer) : templateRefusals(transform, pointer);
}

export function durationRefusals(duration: Json | undefined, pointer: string): readonly Refusal[] {
  if (duration === undefined) {
    return [];
  }
  if (enclosedBody(duration) !== undefined) {
    return expressionRefusals(duration, pointer);
  }
  const reading = readDuration(duration);
  return 'problem' in reading ? [refusal(pointer, reading.problem)] : [];
}

export function timeoutRefusals(
  timeout: Json | undefined,
  pointer: string,
  components: Components,
): readonly Refusal[] {
  if (typeof timeout === 'string') {
    return field(components.timeouts, timeout) === undefined
      ? [refusal(pointer, `use.timeouts has no timeout ${timeout}`)]
      : [];
  }
  return isObject(timeout) ? durationRefusals(field(timeout, 'after'), `${pointer}/after`) : [];
}

export function retryPolicyRefusals(policy: JsonObject, pointer: string): readonly Refusal[] {
  const limit = objectField(policy, 'limit') ?? {};
  const jitter = objectField(policy, 'jitter') ?? {};
  const durations: readonly Located[] = [
    [field(policy, 'delay'), `${pointer}/delay`],
    [field(jitter, 'from'), `${pointer}/jitter/from`],
    [field(jitter, 'to'), `${pointer}/jitter/to`],
    [field(limit, 'duration'), `${pointer}/limit/duration`],
    [field(objectField(limit, 'attempt') ?? {}, 'duration'), `${pointer}/limit/attempt/duration`],
  ];
  return expressionRefusals(field(policy, 'when'), `${pointer}/when`).concat(
    expressionRefusals(field(policy, 'exceptWhen'), `${pointer}/exceptWhen`),
    durations.flatMap(([duration, at]: Located) => durationRefusals(duration, at)),
  );
}
