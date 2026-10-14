import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostFieldDescriptionCharacters, schemaBlocks, type OverviewBlock, type Phrases } from '../index.ts';

function plain(phrases: Phrases): string {
  return phrases
    .map((phrase) => (typeof phrase === 'string' ? phrase : `**${Object.values(phrase).join('')}**`))
    .join('');
}

function shown(block: OverviewBlock): unknown {
  if (block.kind === 'fields') {
    return Object.fromEntries(
      block.rows.map(({ name, required, words }) => [name, `${required ? '!' : ''}${plain(words)}`]),
    );
  }
  return block.kind === 'paragraph' ? plain(block.phrases) : block;
}

function blocksOf(schema?: Schema.JsonObject): readonly unknown[] {
  return schemaBlocks(schema, 'Nothing is said of it.').map((block) => shown(block));
}

function wordsOf(field: Schema.JsonObject): string {
  const [block] = schemaBlocks({ type: 'object', properties: { field } }, '');
  return block?.kind === 'fields' ? plain(block.rows[0]?.words ?? []) : '';
}

function listOf(items: Schema.JsonObject): string {
  return wordsOf({ type: 'array', items });
}

describe('the words of a simple schema', () => {
  it('say a field of each simple type in words', () => {
    expect([
      wordsOf({ type: 'string' }),
      wordsOf({ type: 'string', format: 'date-time' }),
      wordsOf({ type: 'string', format: 'email' }),
      wordsOf({ type: 'integer' }),
      wordsOf({ type: 'number' }),
      wordsOf({ type: 'boolean' }),
      wordsOf({ type: 'null' }),
      wordsOf({}),
      wordsOf({ type: 'mystery' }),
    ]).toEqual([
      'Text.',
      'A date and time.',
      'Text.',
      'A whole number.',
      'A number.',
      'Yes or no.',
      'Nothing.',
      'Any value.',
      'Any value.',
    ]);
  });

  it('say the values a field may take, and that a field takes one value alone', () => {
    expect([
      wordsOf({ enum: ['draft', 'sent', 3, null] }),
      wordsOf({ enum: Array.from({ length: 14 }, (_, index) => `v${index}`) }),
      wordsOf({ const: 'approve' }),
      wordsOf({ const: null }),
      wordsOf({ enum: 'not a list', type: 'string' }),
    ]).toEqual([
      'One of: draft, sent, 3, null.',
      'One of: v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, and 2 more.',
      'Exactly approve.',
      'Exactly null.',
      'Text.',
    ]);
  });
});

describe('the bounds of a schema in words', () => {
  it('say the bounds of a number, a text and a list, and the default a field takes when it is left out', () => {
    expect([
      wordsOf({ type: 'integer', minimum: 1, maximum: 50, default: 5 }),
      wordsOf({ type: 'integer', minimum: 1000 }),
      wordsOf({ type: 'number', maximum: 0.5 }),
      wordsOf({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100 }),
      wordsOf({ type: 'string', maxLength: 200 }),
      wordsOf({ type: 'string', minLength: 1 }),
      wordsOf({ type: 'string', minLength: 2, maxLength: 3, default: 'abc' }),
      wordsOf({ type: 'array', items: { type: 'integer' }, minItems: 1 }),
      wordsOf({ type: 'array', maxItems: 1 }),
      wordsOf({ enum: ['draft', 'sent'], default: 'draft' }),
      wordsOf({ type: 'string', default: 'x'.repeat(400) }),
    ]).toEqual([
      'A whole number, from 1 to 50, 5 when left out.',
      'A whole number, at least 1,000.',
      'A number, at most 0.5.',
      'A number, more than 0, less than 100.',
      'Text, at most 200 characters.',
      'Text, at least 1 character.',
      'Text, 2 to 3 characters, “abc” when left out.',
      'A list of whole numbers, at least 1 item.',
      'A list, at most 1 item.',
      'One of: draft, sent; “draft” when left out.',
      'Text, a default when left out.',
    ]);
  });
});

describe('a list in words', () => {
  it('says a list of each kind, and a list of lists, in the plural', () => {
    expect([
      listOf({ type: 'string' }),
      listOf({ type: 'string', format: 'date-time' }),
      listOf({ type: 'number' }),
      listOf({ type: 'boolean' }),
      listOf({ type: 'null' }),
      listOf({ type: 'array', items: { type: 'integer' } }),
      listOf({ type: 'object' }),
      listOf({ enum: ['a', 'b'] }),
      listOf({ const: 1 }),
      listOf({}),
      listOf({ anyOf: [{ type: 'integer' }, { type: 'string' }] }),
      listOf({ oneOf: Array.from({ length: 5 }, () => ({ type: 'string' })) }),
      wordsOf({ type: 'array', items: [{ type: 'string' }] }),
    ]).toEqual([
      'A list of text.',
      'A list of dates and times.',
      'A list of numbers.',
      'A list of yes-or-no values.',
      'A list of empty values.',
      'A list of lists of whole numbers.',
      'A list of records.',
      'A list of values, each one of: a, b.',
      'A list of values, each exactly 1.',
      'A list of any values.',
      'A list of whole numbers or text.',
      'A list of values of 5 kinds.',
      'A list.',
    ]);
  });
});

describe('the alternatives of a schema in words', () => {
  it('say a field that may take several types, or one of a few schemas, as alternatives', () => {
    expect([
      wordsOf({ type: ['string', 'null'] }),
      wordsOf({ type: ['integer', 7] }),
      wordsOf({ anyOf: [{ type: 'integer' }, { type: 'string', format: 'date-time' }] }),
      wordsOf({ oneOf: [{ type: 'boolean' }, { enum: ['yes', 'no'] }] }),
      wordsOf({ anyOf: Array.from({ length: 5 }, () => ({ type: 'string' })) }),
      wordsOf({ anyOf: [], type: 'string' }),
      wordsOf({ properties: { a: { type: 'string' } } }),
      wordsOf({ items: { type: 'string' } }),
    ]).toEqual([
      'Text or nothing.',
      'A whole number.',
      'A whole number or a date and time.',
      'Yes or no or one of: yes, no.',
      'One of 5 kinds of value.',
      'Text.',
      'A record with: **a** (text, optional).',
      'A list of text.',
    ]);
  });
});

describe('a record in words', () => {
  it('says the fields of a record one level down, each with its words, and a record beneath that as a record', () => {
    expect(
      wordsOf({
        type: 'object',
        required: ['days', 'owner'],
        properties: {
          days: { type: 'integer', minimum: 1, description: 'Days so far' },
          owner: { type: 'object', properties: { name: { type: 'string' } } },
          note: { type: 'string' },
        },
      }),
    ).toBe(
      'A record with: **days** (Days so far; a whole number, at least 1), **owner** (a record), **note** (text, optional).',
    );
    expect(wordsOf({ type: 'object' })).toBe('A record.');
    expect(
      wordsOf({
        type: 'array',
        items: { type: 'object', required: ['campaign'], properties: { campaign: { type: 'string' } } },
      }),
    ).toBe('A list of records with: **campaign** (text).');
    expect(
      wordsOf({
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`f${index}`, {}])),
      }),
    ).toMatch(/\*\*f11\*\* \(any value, optional\), and 2 more\.$/u);
  });
});

describe('a record of entries in words', () => {
  it('says what every entry of a record without fields is, and how many entries it may have', () => {
    const reviews = { type: 'array', maxItems: 20, items: { type: 'object', properties: { at: { type: 'string' } } } };

    expect([
      wordsOf({ type: 'object', maxProperties: 50, additionalProperties: reviews }),
      wordsOf({ type: 'object', minProperties: 1, additionalProperties: { type: 'integer' } }),
      listOf({ type: 'object', additionalProperties: { type: 'string' } }),
      wordsOf({ type: 'object', additionalProperties: false }),
      wordsOf({ type: 'object', properties: { a: { type: 'object', additionalProperties: { type: 'string' } } } }),
      wordsOf({ type: 'object', minProperties: 2, maxProperties: 4 }),
    ]).toEqual([
      'A record whose every entry is a list of records with: **at** (text, optional), at most 20 items, at most 50 entries.',
      'A record whose every entry is a whole number, at least 1 entry.',
      'A list of records whose every entry is text.',
      'A record.',
      'A record with: **a** (a record, optional).',
      'A record, 2 to 4 entries.',
    ]);
  });
});

describe('the references of a schema', () => {
  it('are read within the document, by $defs, definitions or the root', () => {
    const root = {
      type: 'object',
      properties: {
        tag: { $ref: '#/$defs/tag' },
        named: { $ref: '#/$defs/tag', description: 'Its own words' },
        older: { $ref: '#/definitions/a~1b' },
        missing: { $ref: '#/$defs/nowhere' },
        outside: { $ref: 'https://example.com/schema' },
        tree: { $ref: '#/$defs/tree' },
        self: { $ref: '#' },
        astray: { $ref: '#/$defs/tag/type/more' },
      },
      $defs: {
        tag: { type: 'string', minLength: 1, description: 'A tag' },
        tree: { type: 'array', items: { $ref: '#/$defs/tree' } },
      },
      definitions: { 'a/b': { type: 'boolean' } },
    };

    expect(blocksOf(root)).toEqual([
      {
        tag: 'A tag. Text, at least 1 character.',
        named: 'Its own words. Text, at least 1 character.',
        older: 'Yes or no.',
        missing: 'Any value.',
        outside: 'Any value.',
        tree: 'A list of lists of lists of lists of any values.',
        astray: 'Any value.',
        self: 'A record with: **tag** (A tag; text, at least 1 character, optional), **named** (Its own words; text, at least 1 character, optional), **older** (yes or no, optional), **missing** (any value, optional), **outside** (any value, optional), **tree** (a list of lists of lists of any values, optional), **self** (a record, optional), **astray** (any value, optional).',
      },
    ]);
  });
});

describe('the description of a field', () => {
  it("is the author's, as it is, cut at its bound", () => {
    const long = '😀'.repeat(mostFieldDescriptionCharacters + 1);

    expect([
      wordsOf({ type: 'string', description: 'The brief to review' }),
      wordsOf({ type: 'string', description: 'The brief to review.' }),
      wordsOf({ type: 'string', description: '  ' }),
      wordsOf({ type: 'string', description: long }),
    ]).toEqual([
      'The brief to review. Text.',
      'The brief to review. Text.',
      'Text.',
      `${'😀'.repeat(mostFieldDescriptionCharacters)}… Text.`,
    ]);
  });
});

describe('the blocks of a schema', () => {
  it('are a table of its fields, in its order, required or not, and still the fields it does not describe', () => {
    expect(
      blocksOf({
        type: 'object',
        description: 'A campaign brief',
        required: ['brief'],
        properties: { brief: { type: 'string' }, notes: { type: 'string', description: 'Anything else' } },
      }),
    ).toEqual(['A campaign brief.', { brief: '!Text.', notes: 'Anything else. Text.' }]);
  });

  it('are a sentence for a schema that is no record of fields, and the words given for no schema at all', () => {
    expect([
      ...blocksOf({ type: 'array', items: { type: 'object', properties: { campaign: { type: 'string' } } } }),
      ...blocksOf({ type: 'object' }),
      ...blocksOf({ $ref: '#/$defs/row', $defs: { row: { type: 'object', properties: { id: { type: 'integer' } } } } }),
      ...blocksOf(),
    ]).toEqual([
      'A list of records with: **campaign** (text, optional).',
      'A record.',
      { id: 'A whole number.' },
      'Nothing is said of it.',
    ]);
  });
});
