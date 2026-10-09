import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionEvent } from './definition-events.ts';
import { definitionVersionDecider } from './definition-versions.ts';

const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const history: readonly DefinitionEvent[] = [
  { type: 'definition_created', name: 'greet', version: 1, content: { source: 'one' }, ...at },
  { type: 'definition_created', name: 'other', version: 1, content: { source: 'else' }, ...at },
  { type: 'definition_updated', name: 'greet', version: 2, content: { source: 'two' }, ...at },
  { type: 'definition_retired', name: 'greet', ...at },
];

describe('a search for one version of a definition', () => {
  it('finds its document and the position of the record that made it, and decides nothing', () => {
    const search = definitionVersionDecider('greet', 2);

    expect(history.reduce((found, event) => search.evolve(found, event), search.initialState)).toEqual({
      position: 4,
      found: { source: 'two', position: 3 },
    });
    expect(search.decide(null, search.initialState)).toEqual(Result.succeed([]));
  });
});
