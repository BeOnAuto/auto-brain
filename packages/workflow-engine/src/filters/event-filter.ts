import { evaluate, type Place } from '../dsl/evaluation.ts';
import { enclosedBody, freeVariablesOf } from '../dsl/expressions.ts';
import {
  entriesOf,
  field,
  isObject,
  isTruthy,
  jsonEquals,
  objectField,
  type Json,
  type JsonEntry,
  type JsonObject,
} from '../dsl/json.ts';
import { forbidden, rejection, type Rejection } from '../dsl/policy-checks.ts';
import { caughtRaise } from '../dsl/raised-error.ts';
import { eventFilterRejections } from '../dsl/task-policy.ts';
import { pointerTo } from '../dsl/tasks.ts';
import type { DslError } from '../machine/dsl-error.ts';
import { meterOf } from '../runner/run-tables.ts';

type ExpressionVerdict = (expression: string, value: Json) => Json;

export interface LiteralFilter {
  readonly reference: string;
  readonly type: string;
  readonly attributes: JsonObject;
  readonly dataNeedsVariables: boolean;
}

export type LiteralFilterReading = { readonly filter: LiteralFilter } | { readonly rejections: readonly Rejection[] };

export type FilterVerdict = boolean | { readonly error: DslError };

const filterKeys: ReadonlySet<string> = new Set(['with', 'correlate']);

const literalAttributes: readonly string[] = ['type', 'source', 'subject'];

const testedAttributes: ReadonlySet<string> = new Set([...literalAttributes, 'data']);

const noVariables = {};

const noDurations = 0;

function attributeMatches(expected: Json, actual: Json, verdictOf: ExpressionVerdict): boolean {
  const expression = enclosedBody(expected);
  return expression === undefined ? jsonEquals(expected, actual) : isTruthy(verdictOf(expression, actual));
}

export function hasAttributes(event: JsonObject, attributes: JsonObject, verdictOf: ExpressionVerdict): boolean {
  return entriesOf(attributes).every(([name, expected]: JsonEntry) =>
    attributeMatches(expected, field(event, name) ?? null, verdictOf),
  );
}

function strayKeyRejections(filter: JsonObject, attributes: JsonObject, pointer: string): readonly Rejection[] {
  const strayKeys = Object.keys(filter)
    .filter((key) => !filterKeys.has(key))
    .map((key) => forbidden(pointerTo(pointer, key), `${key} is not part of an event filter, which takes with`));
  const strayAttributes = Object.keys(attributes)
    .filter((name) => !testedAttributes.has(name))
    .map((name) =>
      forbidden(
        pointerTo(`${pointer}/with`, name),
        `An event filter matched over the event alone tests type, source, subject and data, not ${name}`,
      ),
    );
  return [...strayKeys, ...strayAttributes];
}

function literalRejection(name: string, expected: Json | undefined, pointer: string): readonly Rejection[] {
  if (expected === undefined) {
    return name === 'type'
      ? [rejection(pointer, 'An event filter matched over the event alone names the type of the events it takes')]
      : [];
  }
  if (typeof expected !== 'string' || expected === '') {
    return [rejection(pointer, `${name} is text that is not empty`)];
  }
  return enclosedBody(expected) === undefined
    ? []
    : [forbidden(pointer, `${name} is written out, not computed by an expression, so that it is matched as it is`)];
}

function literalRejections(attributes: JsonObject, pointer: string): readonly Rejection[] {
  return literalAttributes.flatMap((name) =>
    literalRejection(name, field(attributes, name), pointerTo(`${pointer}/with`, name)),
  );
}

function needsVariables(expected: Json | undefined): boolean {
  const expression = enclosedBody(expected);
  return expression !== undefined && freeVariablesOf(expression).length > 0;
}

function testedOf(attributes: JsonObject, dataNeedsVariables: boolean): JsonObject {
  return dataNeedsVariables
    ? Object.fromEntries(entriesOf(attributes).filter(([name]: JsonEntry) => name !== 'data'))
    : attributes;
}

export function literalFilterOf(filter: Json | undefined, pointer: string): LiteralFilterReading {
  const attributes = isObject(filter) ? objectField(filter, 'with') : undefined;
  if (!isObject(filter) || attributes === undefined) {
    return {
      rejections: [rejection(pointer, 'An event filter is a mapping whose with holds the attributes to match')],
    };
  }
  const type = field(attributes, 'type');
  const rejections = [
    ...eventFilterRejections(filter, pointer),
    ...strayKeyRejections(filter, attributes, pointer),
    ...literalRejections(attributes, pointer),
  ];
  if (typeof type !== 'string' || rejections.length > 0) {
    return { rejections };
  }
  const dataNeedsVariables = needsVariables(field(attributes, 'data'));
  return {
    filter: { reference: pointer, type, attributes: testedOf(attributes, dataNeedsVariables), dataNeedsVariables },
  };
}

export function brainWideFilterOf(filter: Json | undefined): JsonObject | undefined {
  const attributes = isObject(filter) ? objectField(filter, 'with') : undefined;
  const type = attributes === undefined ? undefined : field(attributes, 'type');
  return typeof type === 'string' && type !== '' && enclosedBody(type) === undefined ? attributes : undefined;
}

export function listenerFilterOf(attributes: JsonObject, reference: string): LiteralFilter | undefined {
  const type = field(attributes, 'type');
  if (typeof type !== 'string' || brainWideFilterOf({ with: attributes }) === undefined) {
    return undefined;
  }
  const tested = entriesOf(attributes).filter(([, expected]: JsonEntry) => !needsVariables(expected));
  return {
    reference,
    type,
    attributes: Object.fromEntries(tested),
    dataNeedsVariables: tested.length < entriesOf(attributes).length,
  };
}

export function matchEvent(filter: LiteralFilter, event: JsonObject, now: number): FilterVerdict {
  const place: Place = { reference: filter.reference, now, meter: meterOf(), mostDuration: noDurations };
  return caughtRaise<FilterVerdict>(
    () =>
      hasAttributes(event, filter.attributes, (expression, value) => evaluate(expression, value, noVariables, place)),
    (error) => ({ error }),
  );
}
