import type { RunContext } from '@beonauto/definitions';
import { allTaskEntries, field, isObject, type Json, type JsonObject } from '@beonauto/workflow-engine';
import { enclosedBody } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

import { runDefinitionFunction } from '../document/workflow-functions.ts';

export const callMarginMs = 60_000;

interface CalledDefinition {
  readonly reference: string;
  readonly type: string;
  readonly name: string;
}

function literalOf(value: Json | undefined): string | undefined {
  return typeof value === 'string' && enclosedBody(value) === undefined ? value : undefined;
}

function calledDefinitionOf(task: JsonObject, reference: string): readonly CalledDefinition[] {
  const given = field(task, 'with');
  const type = isObject(given) ? literalOf(field(given, 'type')) : undefined;
  const name = isObject(given) ? literalOf(field(given, 'name')) : undefined;
  return field(task, 'call') !== runDefinitionFunction || type === undefined || name === undefined
    ? []
    : [{ reference, type, name }];
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
    Effect.forEach(called, ({ reference, type, name }) =>
      Effect.map(longestRunOf(type, name), (longest) => limitOf(reference, longest)),
    ),
    (limits: readonly (readonly CallLimit[])[]) => Object.fromEntries(limits.flat()),
  );
}
