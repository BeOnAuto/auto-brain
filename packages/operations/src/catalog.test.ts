import { describe, expect, it } from 'vitest';

import { makeCatalog } from './index.ts';
import { getBrainLabel, labelBrain } from './testing/brain-labels.ts';
import { addNote, getNote } from './testing/notes.ts';

describe('a catalog', () => {
  const catalog = makeCatalog([labelBrain, addNote, getBrainLabel, getNote]);

  it('lists every operation in the order given', () => {
    expect(catalog.operations.map(({ scope, name }) => `${scope}:${name}`)).toEqual([
      'org:label_brain',
      'brain:add_note',
      'org:get_brain_label',
      'brain:get_note',
    ]);
  });

  it('lists the operations of one scope', () => {
    expect(catalog.operationsIn('org').map(({ name }) => name)).toEqual(['label_brain', 'get_brain_label']);
    expect(catalog.operationsIn('brain').map(({ name }) => name)).toEqual(['add_note', 'get_note']);
  });

  it('may be empty', () => {
    expect(makeCatalog([]).operations).toEqual([]);
  });

  it('refuses a name used twice, even across scopes', () => {
    expect(() => makeCatalog([addNote, labelBrain, addNote])).toThrow(
      'The operation name add_note is used more than once',
    );
  });
});
