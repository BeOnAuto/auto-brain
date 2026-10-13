import { describe, expect, it } from 'vitest';

import { mappedSchema, standaloneOf, translatedSchema } from './schema-translation.ts';

const unfollowed =
  'A reference the runtime cannot follow: a schema of a tool server may refer only to #/components/schemas/<name> of its own document';

describe('a schema of a document of OpenAPI 3.0', () => {
  it('turns nullable into a null type, and into a null value of an enum', () => {
    expect(
      translatedSchema(
        {
          type: 'object',
          properties: {
            name: { type: 'string', nullable: true },
            kinds: { type: ['string', 'null'], nullable: true },
            state: { type: 'string', enum: ['open', 'closed'], nullable: true },
            mood: { type: 'string', enum: ['calm', null], nullable: true },
            loose: { nullable: true, description: 'No type to add null to' },
            kept: { type: 'string', nullable: false },
          },
        },
        '3.0',
      ),
    ).toEqual({
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        kinds: { type: ['string', 'null'] },
        state: { type: ['string', 'null'], enum: ['open', 'closed', null] },
        mood: { type: ['string', 'null'], enum: ['calm', null] },
        loose: { description: 'No type to add null to' },
        kept: { type: 'string' },
      },
    });
  });
});

describe('the bounds of a schema of a document of OpenAPI 3.0', () => {
  it('turn their flags of exclusive bounds into the numbers JSON Schema 2020-12 takes', () => {
    expect(
      translatedSchema(
        {
          allOf: [
            { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: false },
            { type: 'number', exclusiveMaximum: true },
            { type: 'number', exclusiveMinimum: 2, minimum: 1 },
          ],
        },
        '3.0',
      ),
    ).toEqual({
      allOf: [
        { type: 'number', exclusiveMinimum: 0, maximum: 10 },
        { type: 'number' },
        { type: 'number', exclusiveMinimum: 2, minimum: 1 },
      ],
    });
  });

  it('is left as it is in a document of OpenAPI 3.1', () => {
    const schema = { type: 'string', nullable: true, exclusiveMinimum: true };

    expect(translatedSchema(schema, '3.1')).toBe(schema);
  });
});

describe('the walk of a schema', () => {
  it('visits every subschema, of one keyword, of a list and of a map, and none of a value', () => {
    const visited: string[] = [];

    mappedSchema(
      {
        items: { type: 'string' },
        additionalProperties: true,
        anyOf: [{ type: 'null' }],
        properties: { a: { type: 'string' } },
        $defs: { b: { type: 'number' } },
        enum: [{ not: {} }],
        examples: [{ properties: { c: {} } }],
        oneOf: { type: 'string' },
        patternProperties: ['d'],
      },
      (object, pointer) => {
        visited.push(pointer);
        return object;
      },
    );

    expect(visited).toEqual(['/items', '/anyOf/0', '/properties/a', '/$defs/b', '']);
  });
});

describe('a schema made to stand alone', () => {
  it('refers to the components it uses under $defs, and names them', () => {
    expect(
      standaloneOf(
        {
          type: 'array',
          items: { $ref: '#/components/schemas/Note~1Draft' },
          contains: { $ref: '#/components/schemas/Tag' },
        },
        '/paths/~1notes/get/parameters/0/schema',
      ),
    ).toEqual({
      schema: { type: 'array', items: { $ref: '#/$defs/Note~1Draft' }, contains: { $ref: '#/$defs/Tag' } },
      references: [
        { name: 'Note/Draft', pointer: '/paths/~1notes/get/parameters/0/schema/items/$ref' },
        { name: 'Tag', pointer: '/paths/~1notes/get/parameters/0/schema/contains/$ref' },
      ],
      problems: [],
    });
  });

  it('names each reference it cannot follow at its place', () => {
    expect(
      standaloneOf(
        { properties: { a: { $ref: 'notes.yaml#/Note' }, b: { $ref: '#/components/parameters/Limit' } } },
        '/x',
      ),
    ).toEqual({
      schema: { properties: { a: { $ref: 'notes.yaml#/Note' }, b: { $ref: '#/components/parameters/Limit' } } },
      references: [],
      problems: [
        { pointer: '/x/properties/a/$ref', detail: unfollowed },
        { pointer: '/x/properties/b/$ref', detail: unfollowed },
      ],
    });
  });
});
