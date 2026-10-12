import type { RunContext } from '@on.auto/definitions';
import {
  allTaskEntries,
  field,
  holdsAnExpression,
  isObject,
  type Json,
  type JsonObject,
} from '@on.auto/workflow-engine';
import { enclosedBody } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { runDefinitionFunction } from '../document/workflow-functions.ts';

export const callMarginMs = 60_000;

type RunLengths = Pick<RunContext, 'longestRunOf' | 'longestRunFor'>;

interface CalledDefinition {
  readonly reference: string;
  readonly longest: (lengths: RunLengths) => Effect.Effect<number | undefined>;
}

function literalOf(value: Json | undefined): string | undefined {
  return typeof value === 'string' && enclosedBody(value) === undefined ? value : undefined;
}

function longestOf(type: string, name: string, given: JsonObject): CalledDefinition['longest'] {
  const input = field(given, 'input') ?? {};
  return holdsAnExpression(input)
    ? ({ longestRunOf }) => longestRunOf(type, name)
    : ({ longestRunFor }) => longestRunFor(type, name, input);
}

function calledDefinitionOf(task: JsonObject, reference: string): readonly CalledDefinition[] {
  const given = field(task, 'with');
  if (field(task, 'call') !== runDefinitionFunction || !isObject(given)) {
    return [];
  }
  const type = literalOf(field(given, 'type'));
  const name = literalOf(field(given, 'name'));
  return type === undefined || name === undefined ? [] : [{ reference, longest: longestOf(type, name, given) }];
}

type CallLimit = readonly [string, number];

function limitOf(reference: string, longest: number | undefined): readonly CallLimit[] {
  return longest === undefined ? [] : [[reference, longest + callMarginMs]];
}

export function longestCallsOf(
  document: JsonObject,
  lengths: RunLengths,
): Effect.Effect<Readonly<Record<string, number>>> {
  const called = allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }) =>
    calledDefinitionOf(task, reference),
  );
  return Effect.map(
    Effect.forEach(called, ({ reference, longest }) =>
      Effect.map(longest(lengths), (longestMs) => limitOf(reference, longestMs)),
    ),
    (limits: readonly (readonly CallLimit[])[]) => Object.fromEntries(limits.flat()),
  );
}
