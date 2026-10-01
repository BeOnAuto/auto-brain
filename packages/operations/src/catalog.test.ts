import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand, defineQuery, makeCatalog } from './index.ts';
import { getBrainLabel, labelBrain } from './testing/brain-labels.ts';
import { addNote, getNote } from './testing/notes.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const probe = { title: 'Probe', description: 'Probes the catalog.', outputSchema: Empty, reasons: [] };

const getNoteById = defineQuery('brain', {
  ...probe,
  name: 'get_note_by_id',
  route: { method: 'GET', path: '/notes/{id}' },
  inputSchema: Schema.Struct({ id: Schema.String }),
  handle: () => Effect.succeed({}),
});

const getLatestNote = defineQuery('brain', {
  ...probe,
  name: 'get_latest_note',
  route: { method: 'GET', path: '/notes/latest' },
  inputSchema: Empty,
  handle: () => Effect.succeed({}),
});

const replaceNote = defineCommand('brain', {
  ...probe,
  name: 'replace_note',
  route: { method: 'PUT', path: '/notes/{name}' },
  inputSchema: Schema.Struct({ name: Schema.String }),
  handle: () => Effect.succeed({}),
});

const getNoteOfBrain = defineQuery('org', {
  ...probe,
  name: 'get_note_of_brain',
  route: { method: 'GET', path: '/brains/{brain}/notes/{name}' },
  inputSchema: Schema.Struct({ brain: Schema.String, name: Schema.String }),
  handle: () => Effect.succeed({}),
});

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

describe('the routes of a catalog', () => {
  it('may not repeat a method and path, whatever their parameters are called', () => {
    expect(() => makeCatalog([getNote, getNoteById])).toThrow(
      'The operations get_note and get_note_by_id share the route GET /orgs/{org}/brains/{brain}/notes/{id}',
    );
  });

  it('may not repeat one across scopes once the scope prefixes are applied', () => {
    expect(() => makeCatalog([getNote, getNoteOfBrain])).toThrow(
      'The operations get_note and get_note_of_brain share the route GET /orgs/{org}/brains/{brain}/notes/{name}',
    );
  });

  it('may share a path under another method, or a literal segment where another has a parameter', () => {
    expect(makeCatalog([getNote, replaceNote, getLatestNote]).operations).toHaveLength(3);
  });
});
