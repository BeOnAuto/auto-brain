import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolDefinitionOf } from './tool-definition.ts';

const Nothing = Schema.Record(Schema.String, Schema.Never);

function askingWith(reach: { readonly reachesOutside?: boolean; readonly mayChangeOutside?: boolean }) {
  return defineQuery('org', {
    name: 'ask_weather',
    title: 'Ask weather',
    description: 'Asks a weather service.',
    route: { method: 'GET', path: '/weather' },
    inputSchema: Nothing,
    outputSchema: Nothing,
    reasons: [],
    handle: () => Effect.succeed({}),
    ...reach,
  });
}

describe('the open-world hint of a tool', () => {
  it('is true when its operation says it reaches systems outside the server, and false otherwise', () => {
    const reaching = toolDefinitionOf(askingWith({ reachesOutside: true }).registration);
    const local = toolDefinitionOf(askingWith({}).registration);

    expect([reaching.annotations.openWorldHint, local.annotations.openWorldHint]).toEqual([true, false]);
  });
});

describe('the destructive hint of a tool', () => {
  it('is true when its operation says it may change something outside the server, and false otherwise', () => {
    const changing = toolDefinitionOf(askingWith({ reachesOutside: true, mayChangeOutside: true }).registration);
    const reading = toolDefinitionOf(askingWith({ reachesOutside: true }).registration);

    expect([changing.annotations.destructiveHint, reading.annotations.destructiveHint]).toEqual([true, false]);
  });
});
