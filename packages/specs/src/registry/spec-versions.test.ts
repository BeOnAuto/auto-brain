import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SpecEvent } from './spec-events.ts';
import { specVersionDecider } from './spec-versions.ts';

const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const history: readonly SpecEvent[] = [
  { type: 'spec_created', name: 'greet', version: 1, content: { source: 'one' }, ...at },
  { type: 'spec_created', name: 'other', version: 1, content: { source: 'else' }, ...at },
  { type: 'spec_updated', name: 'greet', version: 2, content: { source: 'two' }, ...at },
  { type: 'spec_retired', name: 'greet', ...at },
];

describe('a search for one version of a definition', () => {
  it('finds its document and the position of the record that made it, and decides nothing', () => {
    const search = specVersionDecider('greet', 2);

    expect(history.reduce((found, event) => search.evolve(found, event), search.initialState)).toEqual({
      position: 4,
      found: { source: 'two', position: 3 },
    });
    expect(search.decide(null, search.initialState)).toEqual(Result.succeed([]));
  });
});
