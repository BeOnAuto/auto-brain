import type { RunContext } from '@beonauto/definitions';
import { allTaskEntries, field, isList, isObject, type Json, type JsonObject } from '@beonauto/workflow-engine';
import { enclosedBody } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

import { runDefinitionFunction } from '../document/workflow-functions.ts';

export const callMarginMs = 60_000;

interface CalledDefinition {
  readonly reference: string;
  readonly type: string;
  readonly name: string;
  readonly input?: Json;
}

function literalOf(value: Json | undefined): string | undefined {
  return typeof value === 'string' && enclosedBody(value) === undefined ? value : undefined;
}

function holdsNoExpression(value: Json): boolean {
  if (typeof value === 'string') {
    return enclosedBody(value) === undefined;
  }
  if (isList(value)) {
    return value.every((item) => holdsNoExpression(item));
  }
  return !isObject(value) || Object.values(value).every((item) => holdsNoExpression(item));
}

function literalInputOf(given: JsonObject): { readonly input?: Json } {
  const input = field(given, 'input') ?? {};
  return holdsNoExpression(input) ? { input } : {};
}

function calledDefinitionOf(task: JsonObject, reference: string): readonly CalledDefinition[] {
  const given = field(task, 'with');
  if (field(task, 'call') !== runDefinitionFunction || !isObject(given)) {
    return [];
  }
  const type = literalOf(field(given, 'type'));
  const name = literalOf(field(given, 'name'));
  return type === undefined || name === undefined ? [] : [{ reference, type, name, ...literalInputOf(given) }];
}

type CallLimit = readonly [string, number];

function limitOf(reference: string, longest: number | undefined): readonly CallLimit[] {
  return longest === undefined ? [] : [[reference, longest + callMarginMs]];
}

export function longestCallsOf(
  document: JsonObject,
  longestRunOf: RunContext['longestRunOf'],
): Effect.Effect<Readonly<Record<string, number>>> {
  const called = allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }) =>
    calledDefinitionOf(task, reference),
  );
  return Effect.map(
    Effect.forEach(called, ({ reference, type, name, input }) =>
      Effect.map(longestRunOf(type, name, input), (longest) => limitOf(reference, longest)),
    ),
    (limits: readonly (readonly CallLimit[])[]) => Object.fromEntries(limits.flat()),
  );
}
