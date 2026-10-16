import { compileJsonSchema } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { refusedInput, wordedIssuesOf } from '../index.ts';

function refusalOf(document: Schema.JsonObject, value: Schema.Json, what = 'input') {
  const issues = wordedIssuesOf(Result.getOrThrow(compileJsonSchema(document, { what, nesting: 64 })), value);
  return issues.length === 0 ? undefined : refusedInput(issues);
}

function wordsOf(document: Schema.JsonObject, value: Schema.Json, what?: string): string | undefined {
  return refusalOf(document, value, what)?.detail;
}

function fieldWords(field: Schema.JsonObject, value: Schema.Json): string | undefined {
  return wordsOf({ type: 'object', properties: { field } }, { field: value });
}

const month = {
  type: 'string',
  minLength: 6,
  description: 'The month to report on, such as "April 2026" or "2026-04"',
  examples: ['April 2026'],
};

describe('the refusal of a value its schema does not take', () => {
  it('names the field by its name and its description, then the rule it broke, in one sentence', () => {
    expect(wordsOf({ type: 'object', properties: { month } }, { month: 'April' })).toBe(
      'month, The month to report on, such as "April 2026" or "2026-04": expected at least 6 characters.',
    );
    expect(
      wordsOf(
        { type: 'object', properties: { status: { enum: ['draft', 'sent', 'approved'], description: 'The stage' } } },
        { status: 'paid' },
      ),
    ).toBe('status, The stage: expected one of: draft, sent, approved.');
    expect(
      wordsOf(
        { type: 'object', properties: { seats: { type: 'integer', minimum: 1, description: 'How many seats.' } } },
        { seats: 0 },
      ),
    ).toBe('seats, How many seats: expected at least 1.');
  });
});

describe('the words of the rule a value broke', () => {
  it('says the words of each bound a value breaks', () => {
    expect([
      fieldWords({ type: 'string', maxLength: 40 }, 'x'.repeat(41)),
      fieldWords({ type: 'string', minLength: 1 }, ''),
      fieldWords({ type: 'number', maximum: 100 }, 101),
      fieldWords({ type: 'number', exclusiveMinimum: 0 }, 0),
      fieldWords({ type: 'number', exclusiveMaximum: 1 }, 1),
      fieldWords({ type: 'number', multipleOf: 0.5 }, 0.3),
      fieldWords({ type: 'array', minItems: 1 }, []),
      fieldWords({ type: 'array', maxItems: 2 }, [1, 2, 3]),
      fieldWords({ type: 'array', uniqueItems: true }, ['a', 'a']),
      fieldWords({ type: 'object', minProperties: 1 }, {}),
      fieldWords({ type: 'object', maxProperties: 1 }, { a: 1, b: 2 }),
    ]).toEqual([
      'field: expected at most 40 characters.',
      'field: expected at least 1 character.',
      'field: expected at most 100.',
      'field: expected more than 0.',
      'field: expected less than 1.',
      'field: expected a multiple of 0.5.',
      'field: expected at least 1 item.',
      'field: expected at most 2 items.',
      'field: expected no item twice.',
      'field: expected at least 1 entry.',
      'field: expected at most 1 entry.',
    ]);
  });
});

describe('the words of a value of another kind', () => {
  it('says what a field of another kind takes, as the overview words the field', () => {
    expect([
      fieldWords({ type: 'integer', minimum: 1, maximum: 100 }, 2.5),
      fieldWords({ type: 'number' }, 'many'),
      fieldWords({ type: 'string', format: 'date' }, 5),
      fieldWords({ type: 'boolean' }, 'yes'),
      fieldWords({ type: ['string', 'null'] }, 1),
      fieldWords({ const: 'approve' }, 'reject'),
      fieldWords({ allOf: [{ description: 'The total' }, { type: 'integer' }] }, 'x'),
      fieldWords({ type: 'object', required: ['city'], properties: { city: { type: 'string' } } }, 'Paris'),
    ]).toEqual([
      'field: expected a whole number, from 1 to 100.',
      'field: expected a number.',
      'field: expected text in the form the schema calls date.',
      'field: expected yes or no.',
      'field: expected text or nothing.',
      'field: expected exactly approve.',
      'field, The total: expected a whole number.',
      'field: expected a record with: city (text).',
    ]);
  });
});

describe('the examples of a refused field', () => {
  it('gives the examples of a field when its description gives none, in words', () => {
    expect([
      fieldWords({ type: 'string', minLength: 3, examples: ['ACME-001', 'ACME-002'] }, 'A'),
      fieldWords({ type: 'string', minLength: 3, description: 'The code of the part', examples: ['ACME-001'] }, 'A'),
      fieldWords({ type: 'integer', minimum: 2, description: 'At least 5 of them', examples: [5] }, 1),
      fieldWords({ type: 'string', minLength: 2, examples: ['x'.repeat(400)] }, 'x'),
      fieldWords({ type: 'string', minLength: 2, description: 'ID of the order' }, 'x'),
    ]).toEqual([
      'field, such as “ACME-001” or “ACME-002”: expected at least 3 characters.',
      'field, The code of the part, such as “ACME-001”: expected at least 3 characters.',
      'field, At least 5 of them: expected at least 2.',
      'field: expected at least 2 characters.',
      'field, ID of the order: expected at least 2 characters.',
    ]);
  });
});

const order = {
  type: 'object',
  required: ['month', 'address'],
  additionalProperties: false,
  properties: {
    month,
    address: {
      type: 'object',
      description: 'Where it goes',
      required: ['city'],
      properties: { city: { type: 'string', minLength: 2, description: 'The city' } },
    },
    lines: { type: 'array', items: { $ref: '#/$defs/line' } },
    pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], minItems: 2, items: false },
    totals: { type: 'object', additionalProperties: { type: 'integer', description: 'A total in cents' } },
  },
  $defs: { line: { type: 'object', properties: { amount: { type: 'integer', description: 'The amount' } } } },
};

describe('the refusal of a value whose fields do not fit', () => {
  it('names a missing field, or one the schema does not take, at the field that holds it', () => {
    expect(wordsOf(order, { address: {}, extra: true })).toBe(
      'The input: expected no field extra. ' +
        'The input: expected the field month, The month to report on, such as "April 2026" or "2026-04". ' +
        'address, Where it goes: expected the field city, The city.',
    );
  });

  it('names a nested field by its path in words, with the items of a list by their place', () => {
    expect(
      wordsOf(order, {
        month: 'April 2026',
        address: { city: 'X' },
        lines: [{ amount: 1 }, { amount: 'ten' }],
        totals: { june: 1.5 },
      }),
    ).toBe(
      'address, then city, The city: expected at least 2 characters. ' +
        'lines, then item 2, then amount, The amount: expected a whole number. ' +
        'totals, then june, A total in cents: expected a whole number.',
    );
    expect(wordsOf(order, { month: 'April 2026', address: { city: 'Paris' }, pair: ['a'] })).toBe(
      'pair: expected item 2.',
    );
    expect(wordsOf(order, { month: 'April 2026', address: { city: 'Paris' }, pair: ['a', 1, 2] })).toBe(
      'pair: expected no item 3.',
    );
  });

  it('keeps the pointer of each issue, beside its sentence, so a reader can show it at its field', () => {
    expect(refusalOf(order, { address: { city: 'X' } })?.issues).toEqual([
      {
        pointer: '/month',
        detail: 'The input: expected the field month, The month to report on, such as "April 2026" or "2026-04".',
      },
      { pointer: '/address/city', detail: 'address, then city, The city: expected at least 2 characters.' },
    ]);
  });
});

describe('the refusal of a value no keyword of the schema words', () => {
  it('says the words of the validator about the field, or about the whole value', () => {
    expect([
      fieldWords({ oneOf: [{ type: 'string' }, { type: 'string', minLength: 1 }] }, 'a'),
      fieldWords({ type: 'object', propertyNames: { enum: ['a'] } }, { b: 1 }),
      wordsOf({ oneOf: [{ type: 'string' }, { type: 'string', minLength: 1 }] }, 'a', 'answer'),
    ]).toEqual([
      'field: expected exactly one member to match.',
      'field, then b: expected "a".',
      'Expected exactly one member to match.',
    ]);
  });

  it('says why a value it cannot check is refused, in the words of the check', () => {
    const shallow = Result.getOrThrow(compileJsonSchema({ type: 'array' }, { what: 'input', nesting: 1 }));

    expect(wordedIssuesOf(shallow, [[1]])).toEqual([{ pointer: '', detail: 'The input nests more than 1 levels.' }]);
  });
});

describe('the refusal of a value as a whole', () => {
  it('names the root as what the schema checks', () => {
    expect(wordsOf({ type: 'object' }, 'x', 'answer')).toBe('The answer: expected a record.');
  });

  it('says a value is one where the schema allows none, at the field that holds it', () => {
    expect([
      fieldWords({ not: {} }, 1),
      fieldWords({ type: 'object', additionalProperties: false }, { now: true }),
      wordsOf({ not: {} }, 1),
    ]).toEqual([
      'The input: expected no field field.',
      'field: expected no field now.',
      'The input: expected no value.',
    ]);
  });

  it('is no refusal at all for a value the schema takes', () => {
    expect(refusalOf({ type: 'object', properties: { month } }, { month: 'April 2026' })).toBeUndefined();
  });
});
