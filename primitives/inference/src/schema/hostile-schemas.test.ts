import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileAnswerSchema, schemaLimits } from './answer-schema.ts';

const unsafePattern = 'Regular expressions are not accepted, because a hostile pattern can stall validation';
const typeNames = 'Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them';

function issuesOf(document: unknown): unknown {
  return Result.match(compileAnswerSchema(document), { onSuccess: () => [], onFailure: (issues) => issues });
}

function values(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `v${index}`);
}

function nestedSchemas(levels: number): Schema.Json {
  let schema: Schema.Json = { type: 'string' };
  for (let level = 0; level < levels; level += 1) {
    schema = { type: 'object', properties: { next: schema } };
  }
  return schema;
}

const malformed: readonly (readonly [unknown, string, string])[] = [
  [{ type: 'banana' }, '/type', typeNames],
  [{ type: [] }, '/type', typeNames],
  [{ properties: 5 }, '/properties', 'Expected an object of schemas'],
  [{ properties: { a: 'string' } }, '/properties/a', 'Expected a schema: a JSON object, or true or false'],
  [{ required: ['a', 1] }, '/required', 'Expected a list of strings'],
  [{ anyOf: [] }, '/anyOf', 'Expected a non-empty list of schemas'],
  [{ anyOf: [{ type: 'nope' }] }, '/anyOf/0/type', typeNames],
  [{ enum: [] }, '/enum', 'Expected a non-empty list of strings, numbers, booleans or null'],
  [{ enum: [{ a: 1 }] }, '/enum', 'Expected a non-empty list of strings, numbers, booleans or null'],
  [{ const: [1] }, '/const', 'Only strings, numbers, booleans and null can be constants'],
  [
    { $ref: 'https://example.com/schema.json' },
    '/$ref',
    'Expected a reference to a definition of this schema, such as "#/$defs/address"',
  ],
  [{ description: 5 }, '/description', 'Expected a string'],
  [{ minimum: '1' }, '/minimum', 'Expected a number'],
  [{ multipleOf: 0 }, '/multipleOf', 'Expected a number greater than 0'],
  [{ minLength: -1 }, '/minLength', 'Expected an integer of 0 or more'],
  [{ maxItems: 1.5 }, '/maxItems', 'Expected an integer of 0 or more'],
  [{ uniqueItems: 'yes' }, '/uniqueItems', 'Expected true or false'],
  [{ examples: 'one' }, '/examples', 'Expected a list'],
  [{ not: { type: 'string' } }, '/not', 'Only "not": {} (no value matches) can be validated here'],
  [{ if: {}, else: {} }, '/if', 'Conditional schemas (if, then and else) cannot be validated here'],
  [{ contains: {} }, '/contains', 'contains, minContains and maxContains cannot be validated here'],
  [
    { dependentRequired: {} },
    '/dependentRequired',
    'Dependent schemas and dependent required keys cannot be validated here',
  ],
  [
    { unevaluatedProperties: false },
    '/unevaluatedProperties',
    'unevaluatedItems and unevaluatedProperties cannot be validated here',
  ],
  [
    { additionalItems: false },
    '/additionalItems',
    'additionalItems cannot be validated here; use prefixItems and items',
  ],
  [
    { $dynamicRef: '#x' },
    '/$dynamicRef',
    'Dynamic and recursive anchors cannot be validated here; use $ref to "#/$defs/<name>"',
  ],
  [
    { properties: { a: { type: 'string' } }, additionalProperties: { type: 'number' } },
    '/additionalProperties',
    'A schema for additionalProperties cannot be combined with properties here',
  ],
];

describe('a hostile schema', () => {
  it('may not use regular expressions', () => {
    expect(issuesOf({ type: 'string', pattern: '^(a+)+$' })).toEqual([{ pointer: '/pattern', detail: unsafePattern }]);
    expect(issuesOf({ patternProperties: { '^x': { type: 'string' } } })).toEqual([
      { pointer: '/patternProperties', detail: unsafePattern },
    ]);
  });

  it('may not nest deeper than the limit, and is rejected without overflowing the stack', () => {
    expect(issuesOf(nestedSchemas(5000))).toEqual([
      { pointer: '', detail: `A schema may nest at most ${schemaLimits.nesting} levels of objects and lists` },
    ]);
  });

  it('may not be larger than the limit', () => {
    expect(issuesOf({ type: 'string', description: 'x'.repeat(schemaLimits.bytes) })).toEqual([
      { pointer: '', detail: `A schema may take at most ${schemaLimits.bytes} bytes as JSON` },
    ]);
  });

  it('may list at most 1000 values in an enum', () => {
    expect(issuesOf({ enum: values(1001) })).toEqual([
      { pointer: '/enum', detail: 'An enum may list at most 1000 values' },
    ]);
    expect(issuesOf({ enum: values(1000) })).toEqual([]);
  });
});

describe('a malformed schema', () => {
  it.each([
    ['a list', ['string']],
    ['a string', 'object'],
    ['null', null],
    ['a value that is not JSON', { default: new Date(0) }],
  ])('is rejected when it is %s', (_: string, document: unknown) => {
    expect(issuesOf(document)).toEqual([{ pointer: '', detail: 'A schema is a JSON object' }]);
  });

  it.each(malformed)('is rejected for %j', (document, pointer, detail) => {
    expect(issuesOf(document)).toContainEqual({ pointer, detail });
  });

  it('is rejected when it references a definition it does not have', () => {
    expect(issuesOf({ $ref: '#/$defs/missing' })).toEqual([
      { pointer: '', detail: 'Missing definition "missing" for $ref "#/$defs/missing".' },
    ]);
  });
});

describe('a schema with annotations and boolean subschemas', () => {
  it('is accepted', () => {
    const accepted = {
      type: 'object',
      title: 'Answer',
      $comment: 'internal',
      $id: 'https://example.com/answer',
      properties: {
        anything: true,
        nothing: false,
        flag: { type: 'boolean', readOnly: true, default: false },
        fixed: { const: 'x' },
        step: { type: 'number', multipleOf: 0.5, exclusiveMinimum: 0, exclusiveMaximum: 1, maximum: 2 },
      },
      prefixItems: [{ type: 'string' }],
      examples: [{ flag: true }],
      deprecated: false,
      writeOnly: false,
      format: 'custom',
      minItems: 0,
      minProperties: 0,
      maxProperties: 9,
      maxLength: 9,
    };

    expect(issuesOf(accepted)).toEqual([]);
    expect(issuesOf({ not: {} })).toEqual([]);
  });
});
