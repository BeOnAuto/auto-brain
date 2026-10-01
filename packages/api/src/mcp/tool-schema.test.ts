import { describe, expect, it } from 'vitest';

import { advertisedSchemaOf, selfContainedSchemaOf } from './tool-schema.ts';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const Brain = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };

describe('selfContainedSchemaOf', () => {
  it('declares the dialect and leaves out $defs when there are no definitions', () => {
    expect(selfContainedSchemaOf({ schema: { type: 'object', properties: {} }, definitions: {} })).toEqual({
      $schema: dialect,
      type: 'object',
      properties: {},
    });
  });

  it('inlines a root that refers to a definition, so the root carries its properties, and keeps the definitions', () => {
    expect(
      selfContainedSchemaOf({ schema: { type: 'object', $ref: '#/$defs/Brain' }, definitions: { Brain } }),
    ).toEqual({ $schema: dialect, ...Brain, $defs: { Brain } });
  });

  it('hoists definitions that nested schemas refer to', () => {
    const schema = { type: 'object', properties: { brains: { type: 'array', items: { $ref: '#/$defs/Brain' } } } };

    expect(selfContainedSchemaOf({ schema, definitions: { Brain } })).toEqual({
      $schema: dialect,
      ...schema,
      $defs: { Brain },
    });
  });

  it.each([
    ['refers outside the document', 'https://example.com/brain.json'],
    ['refers to a definition the document lacks', '#/$defs/Missing'],
  ])('leaves a root that %s as it is', (_case, reference) => {
    expect(selfContainedSchemaOf({ schema: { type: 'object', $ref: reference }, definitions: { Brain } })).toEqual({
      $schema: dialect,
      type: 'object',
      $ref: reference,
      $defs: { Brain },
    });
  });
});

describe('advertisedSchemaOf', () => {
  it('advertises the self-contained schema for input and output, and accepts any value so the operation validates', () => {
    const { '~standard': standard } = advertisedSchemaOf({ schema: { type: 'object' }, definitions: {} });
    expect({
      vendor: standard.vendor,
      input: standard.jsonSchema.input({ target: 'draft-2020-12' }),
      output: standard.jsonSchema.output({ target: 'draft-07' }),
      validated: standard.validate({ anything: 1 }),
    }).toEqual({
      vendor: 'auto-brain',
      input: { $schema: dialect, type: 'object' },
      output: { $schema: dialect, type: 'object' },
      validated: { value: { anything: 1 } },
    });
  });
});
