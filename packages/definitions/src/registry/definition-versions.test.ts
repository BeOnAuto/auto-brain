import type { Context, Recorded } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionEvent } from './definition-events.ts';
import { definitionVersionDecider } from './definition-versions.ts';

function about(name: string, version?: number): Context {
  return {
    by: 'acme-admin',
    at: '2026-10-01T09:00:00.000Z',
    definitionType: 'echo',
    definitionName: name,
    ...(version === undefined ? {} : { definitionVersion: version }),
  };
}

const history: readonly Recorded<DefinitionEvent>[] = [
  { type: 'definition_created', data: { content: { source: 'one' } }, context: about('greet', 1) },
  { type: 'definition_created', data: { content: { source: 'else' } }, context: about('other', 1) },
  {
    type: 'definition_updated',
    data: { content: { source: 'two', stripped: { module: 'TWO' } } },
    context: about('greet', 2),
  },
  { type: 'definition_retired', data: {}, context: about('greet') },
];

describe('a search for one version of a definition', () => {
  it('finds its document and the position of the record that made it, and decides nothing', () => {
    const search = definitionVersionDecider('greet', 2);

    expect(history.reduce((found, event) => search.evolve(found, event), search.initialState)).toEqual({
      position: 4,
      found: { source: 'two', stripped: { module: 'TWO' }, position: 3 },
    });
    expect(search.decide(null, search.initialState)).toEqual(Result.succeed([]));
    expect(search.context(null, search.initialState)).toEqual({ at: '', by: '' });
    expect(
      history.reduce(
        (found, event) => definitionVersionDecider('greet', 1).evolve(found, event),
        definitionVersionDecider('greet', 1).initialState,
      ),
    ).toEqual({ position: 4, found: { source: 'one', position: 1 } });
  });
});
