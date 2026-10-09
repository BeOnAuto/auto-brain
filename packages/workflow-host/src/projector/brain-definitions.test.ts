import { describe, expect, it } from 'vitest';

import { detailsOf } from '../views-testing/view-documents.ts';
import { definitionsAfter, noDefinitions } from './brain-definitions.ts';

const saved = {
  type: 'definition_created',
  name: 'runs',
  version: 1,
  content: {
    source: 'the runs document',
    details: { fold: 'export function fold(view: number): number { return view + 1; }' },
  },
  by: 'acme-admin',
  at: '2026-10-06T09:00:00.000Z',
};

describe('the recall functions a brain keeps', () => {
  it('counts an event it cannot read as a version of the stream, and keeps the functions as they were', () => {
    const definitions = definitionsAfter(noDefinitions, [saved, { type: 'definition_renamed', name: 'runs' }]);

    expect(definitions.version).toBe(2);
    expect([...definitions.functions]).toEqual([
      [
        'runs',
        { version: 1, saved: 1, details: { fold: 'export function fold(view: number): number { return view + 1; }' } },
      ],
    ]);
  });
});

describe('the fold a brain keeps for a recall function', () => {
  it('is the module and the filters its save stripped, and the details as written when it stripped none', () => {
    const typed = detailsOf('export function fold(view: number): number { return view + 1; }', [
      { type: 'noted', data: '${ $data.n as number > 1 }' },
    ]);
    const stripped = {
      module: 'export function fold(view        )         { return view + 1; }',
      expressions: { ' $data.n as number > 1 ': ' $data.n           > 1 ' },
    };

    const kept = definitionsAfter(noDefinitions, [
      { ...saved, content: { source: 'a', details: typed, stripped } },
      { ...saved, name: 'plain', content: { source: 'b', details: typed } },
    ]);

    expect(kept.functions.get('runs')?.details).toEqual({
      ...typed,
      fold: stripped.module,
      filters: [{ type: 'noted', data: '${ $data.n           > 1 }' }],
    });
    expect(kept.functions.get('plain')?.details).toEqual(typed);
  });
});
