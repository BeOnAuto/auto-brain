import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainArgumentOf, withBrainArgument } from './brain-argument.ts';

const brainProperty = {
  type: 'string',
  pattern: '^[a-z][a-z0-9-]{2,47}$',
  description: 'The id of the brain to act in',
};

const Labelled = {
  type: 'object',
  properties: { label: { type: 'string' } },
  required: ['label'],
  additionalProperties: false,
};

describe('withBrainArgument', () => {
  it('adds a required brain first to an object schema, keeping its fields', () => {
    expect(withBrainArgument(Labelled)).toEqual({
      type: 'object',
      properties: { brain: brainProperty, label: { type: 'string' } },
      required: ['brain', 'label'],
      additionalProperties: false,
    });
  });

  it('adds a brain to an object schema whose fields are all optional', () => {
    expect(withBrainArgument({ type: 'object', additionalProperties: false })).toEqual({
      type: 'object',
      properties: { brain: brainProperty },
      required: ['brain'],
      additionalProperties: false,
    });
  });

  it('adds a brain to every member of a union, inlining a member that refers to a definition', () => {
    const union = {
      type: 'object',
      anyOf: [{ $ref: '#/$defs/Labelled' }, { type: 'object', properties: { count: { type: 'integer' } } }],
      $defs: { Labelled },
    };

    expect(withBrainArgument(union)).toEqual({
      ...union,
      anyOf: [
        { ...Labelled, properties: { brain: brainProperty, label: { type: 'string' } }, required: ['brain', 'label'] },
        { type: 'object', properties: { brain: brainProperty, count: { type: 'integer' } }, required: ['brain'] },
      ],
    });
  });

  it('adds a brain to a union without definitions', () => {
    expect(withBrainArgument({ anyOf: [Labelled] })).toEqual({
      anyOf: [
        { ...Labelled, properties: { brain: brainProperty, label: { type: 'string' } }, required: ['brain', 'label'] },
      ],
    });
  });
});

const inputsWithoutBrain: ReadonlyArray<readonly [string, unknown, string]> = [
  ['without a brain', { name: 'greeting' }, 'Missing key'],
  ['that is not an object', 'alpha', 'Missing key'],
  ['whose brain is not a string', { brain: 7 }, 'Expected string'],
];

describe('brainArgumentOf', () => {
  it('takes the brain out of the input, leaving the operation its own fields', () => {
    expect(brainArgumentOf({ brain: 'alpha', name: 'greeting' })).toEqual(
      Result.succeed({ brain: 'alpha', input: { name: 'greeting' } }),
    );
  });

  it.each(inputsWithoutBrain)('rejects an input %s as invalid_input pointing at /brain', (_case, input, detail) => {
    expect(brainArgumentOf(input)).toEqual(
      Result.fail({
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The input does not match the input schema',
        issues: [{ detail, pointer: '/brain' }],
      }),
    );
  });
});
