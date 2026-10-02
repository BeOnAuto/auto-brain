import { Result, Schema } from 'effect';
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

describe('withBrainArgument on an object', () => {
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
});

describe('withBrainArgument on a union', () => {
  it('adds a brain to every member, inlining a member that refers to a definition and dropping it', () => {
    const union = {
      type: 'object',
      anyOf: [{ $ref: '#/$defs/Labelled' }, { type: 'object', properties: { count: { type: 'integer' } } }],
      $defs: { Labelled },
    };

    expect(withBrainArgument(union)).toEqual({
      type: 'object',
      anyOf: [
        { ...Labelled, properties: { brain: brainProperty, label: { type: 'string' } }, required: ['brain', 'label'] },
        { type: 'object', properties: { brain: brainProperty, count: { type: 'integer' } }, required: ['brain'] },
      ],
    });
  });

  it('keeps the definitions the inlined members still refer to', () => {
    const Tag = { type: 'string' };
    const Tagged = { type: 'object', properties: { tag: { $ref: '#/$defs/Tag' } } };

    expect(withBrainArgument({ anyOf: [{ $ref: '#/$defs/Tagged' }], $defs: { Tagged, Tag } })).toEqual({
      anyOf: [
        { type: 'object', properties: { brain: brainProperty, tag: { $ref: '#/$defs/Tag' } }, required: ['brain'] },
      ],
      $defs: { Tag },
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

const recordOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

const malformed = 'Expected a string matching the RegExp ^[a-z][a-z0-9-]{2,47}$';

const inputsWithoutBrain: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>, string]> = [
  ['without a brain', { name: 'greeting' }, 'Missing key'],
  ['whose brain is not a string', { brain: 7 }, 'Expected string'],
  ['whose brain is empty', { brain: '' }, malformed],
  ['whose brain has 2 characters', { brain: 'ab' }, malformed],
  ['whose brain has 49 characters', { brain: `a${'b'.repeat(48)}` }, malformed],
  ['whose brain has 100 000 characters', { brain: 'a'.repeat(100_000) }, malformed],
  ['whose brain ends with a newline', { brain: 'alpha\n' }, malformed],
  ['whose brain is uppercase', { brain: 'Alpha' }, malformed],
  ['whose brain has a fullwidth letter', { brain: 'ａlpha' }, malformed],
  ['whose brain has a Cyrillic lookalike', { brain: 'аlpha' }, malformed],
  ['whose brain has a NUL', { brain: 'alp\u0000ha' }, malformed],
  ['whose brain is *', { brain: '*' }, malformed],
];

describe('brainArgumentOf', () => {
  it('takes the brain out of the input, leaving the operation its own fields', () => {
    expect(brainArgumentOf({ brain: 'alpha', name: 'greeting' })).toEqual(
      Result.succeed({ brain: 'alpha', input: { name: 'greeting' } }),
    );
  });

  it('keeps an own __proto__ field for the operation to judge', () => {
    const parsed: unknown = JSON.parse('{"brain":"alpha","__proto__":{"admin":true}}');

    const argument = brainArgumentOf(recordOf(parsed));

    expect(Result.map(argument, ({ input: rest }) => Object.hasOwn(rest, '__proto__'))).toEqual(Result.succeed(true));
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
