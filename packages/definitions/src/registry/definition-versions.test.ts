import type { DefinitionContext } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import type { RecordedDefinitionEvent } from './definition-events.ts';
import { definitionVersionFold } from './definition-versions.ts';

function about(name: string, version: number): DefinitionContext {
  return {
    by: 'acme-admin',
    at: '2026-10-01T09:00:00.000Z',
    definitionType: 'echo',
    definitionName: name,
    definitionVersion: version,
  };
}

const history: readonly RecordedDefinitionEvent[] = [
  { type: 'definition_created', data: { content: { source: 'one' } }, context: about('greet', 1) },
  { type: 'definition_created', data: { content: { source: 'else' } }, context: about('other', 1) },
  {
    type: 'definition_updated',
    data: { content: { source: 'two', stripped: { module: 'TWO' } } },
    context: about('greet', 2),
  },
  { type: 'definition_retired', data: {}, context: about('greet', 2) },
];

describe('a search for one version of a definition', () => {
  it('finds its document and the position of the record that made it, as a fold that decides nothing', () => {
    const search = definitionVersionFold('greet', 2);
    const first = definitionVersionFold('greet', 1);

    expect(history.reduce((found, event) => search.evolve(found, event), search.initialState)).toEqual({
      position: 4,
      found: { source: 'two', stripped: { module: 'TWO' }, position: 3 },
    });
    expect(Object.keys(search).toSorted()).toEqual(['eventSchema', 'evolve', 'initialState']);
    expect(history.reduce((found, event) => first.evolve(found, event), first.initialState)).toEqual({
      position: 4,
      found: { source: 'one', position: 1 },
    });
  });
});
