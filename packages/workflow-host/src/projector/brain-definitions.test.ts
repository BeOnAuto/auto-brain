import { describe, expect, it } from 'vitest';

import { definitionsAfter, noDefinitions } from './brain-definitions.ts';

const saved = {
  type: 'definition_created',
  name: 'runs',
  version: 1,
  content: { source: 'the runs document', details: { fold: '. + 1' } },
  by: 'acme-admin',
  at: '2026-10-06T09:00:00.000Z',
};

describe('the recall functions a brain keeps', () => {
  it('counts an event it cannot read as a version of the stream, and keeps the functions as they were', () => {
    const definitions = definitionsAfter(noDefinitions, [saved, { type: 'definition_renamed', name: 'runs' }]);

    expect(definitions.version).toBe(2);
    expect([...definitions.functions]).toEqual([['runs', { version: 1, saved: 1, details: { fold: '. + 1' } }]]);
  });
});
