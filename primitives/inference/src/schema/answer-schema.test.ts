import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { compileAnswerSchema, schemaLimits, type AnswerSchema } from './answer-schema.ts';

const verdict = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    score: { type: 'integer', minimum: 0, maximum: 10 },
    tags: { type: 'array', items: { enum: ['urgent', 'routine'] } },
  },
  required: ['answer', 'score', 'tags'],
  additionalProperties: false,
};

const tree = {
  $defs: {
    node: {
      type: 'object',
      properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } },
      required: ['children'],
    },
  },
  $ref: '#/$defs/node',
};

function compiled(document: unknown): AnswerSchema {
  return Result.getOrThrow(compileAnswerSchema(document));
}

function answerIssues(schema: AnswerSchema, answer: unknown): unknown {
  return Result.match(schema.validate(answer), { onSuccess: () => [], onFailure: (issues) => issues });
}

function nestedObjects(levels: number): Schema.Json {
  let value: Schema.Json = 'leaf';
  for (let level = 0; level < levels; level += 1) {
    value = { next: value };
  }
  return value;
}

function nestedChildren(levels: number): Schema.Json {
  let value: Schema.Json = [];
  for (let level = 0; level < levels; level += 1) {
    value = { children: [value] };
  }
  return value;
}

describe('an answer that matches the schema', () => {
  it('is returned unchanged', () => {
    const answer = { answer: 'yes', score: 7, tags: ['urgent'] };

    expect(compiled(verdict).validate(answer)).toEqual(Result.succeed(answer));
  });

  it('keeps the extra properties of an open object', () => {
    const open = compiled({ type: 'object', properties: { a: { type: 'string' } } });

    expect(open.validate({ a: 'x', b: 2 })).toEqual(Result.succeed({ a: 'x', b: 2 }));
  });

  it('is checked against recursive definitions and draft-07 definitions', () => {
    const draft = compiled({
      $schema: 'http://json-schema.org/draft-07/schema#',
      definitions: { name: { type: 'string' } },
      type: 'object',
      properties: { first: { $ref: '#/definitions/name' } },
      required: ['first'],
    });
    const undeclared = compiled({
      definitions: { name: { type: 'string' } },
      properties: { first: { $ref: '#/definitions/name' } },
    });

    expect(answerIssues(compiled(tree), { children: [{ children: [] }, { children: [{ children: 5 }] }] })).toEqual([
      { pointer: '/children/1/children/0/children', detail: 'Expected array' },
    ]);
    expect(answerIssues(draft, { first: 1 })).toEqual([{ pointer: '/first', detail: 'Expected name' }]);
    expect(answerIssues(undeclared, { first: 'Ada' })).toEqual([]);
  });

  it('keeps the document as written', () => {
    expect(compiled(verdict).document).toEqual(verdict);
  });
});

describe('an answer that does not match the schema', () => {
  it('is reported with a JSON pointer for every mismatch', () => {
    expect(answerIssues(compiled(verdict), { answer: 42, score: 11, tags: ['later'], extra: true })).toEqual([
      { pointer: '/extra', detail: 'Expected no excess property' },
      { pointer: '/answer', detail: 'Expected string' },
      { pointer: '/score', detail: 'Expected a value less than or equal to 10' },
      { pointer: '/tags/0', detail: 'Expected "urgent" | "routine"' },
    ]);
    expect(answerIssues(compiled(verdict), { answer: 'yes', tags: [] })).toEqual([
      { pointer: '/score', detail: 'Missing key' },
    ]);
  });

  it('is never quoted in an issue', () => {
    const issues = JSON.stringify(answerIssues(compiled(verdict), { answer: 'confidential text', score: -1, tags: 5 }));

    expect(issues).not.toContain('confidential');
    expect(issues).not.toContain('-1');
  });

  it('is reported with escaped pointer tokens', () => {
    const schema = compiled({
      properties: { 'a/b': { type: 'string' }, 'c~d': { type: 'string' } },
      required: ['a/b', 'c~d'],
    });

    expect(answerIssues(schema, { 'a/b': 1, 'c~d': 2 })).toEqual([
      { pointer: '/a~1b', detail: 'Expected string' },
      { pointer: '/c~0d', detail: 'Expected string' },
    ]);
  });

  it('is reported with at most the limit of issues', () => {
    const many = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`p${index}`, { type: 'string' }]));

    expect(answerIssues(compiled({ properties: many, required: Object.keys(many) }), {})).toHaveLength(
      schemaLimits.issues,
    );
  });
});

describe('an answer that cannot be checked', () => {
  it('is rejected when it is nested deeper than the limit', () => {
    const anything = compiled({});

    expect(answerIssues(anything, nestedObjects(schemaLimits.answerNesting + 1))).toEqual([
      { pointer: '', detail: `The answer nests more than ${schemaLimits.answerNesting} levels` },
    ]);
    expect(anything.validate(nestedObjects(schemaLimits.answerNesting))).toEqual(
      Result.succeed(nestedObjects(schemaLimits.answerNesting)),
    );
  });

  it('is rejected, without overflowing the stack, when a recursive schema meets a deep answer', () => {
    expect(answerIssues(compiled(tree), nestedChildren(100_000))).toEqual([
      { pointer: '', detail: `The answer nests more than ${schemaLimits.answerNesting} levels` },
    ]);
  });

  it('is rejected when it is not JSON', () => {
    expect(answerIssues(compiled({}), new Date(0))).toEqual([{ pointer: '', detail: 'The answer is not JSON' }]);
  });
});
