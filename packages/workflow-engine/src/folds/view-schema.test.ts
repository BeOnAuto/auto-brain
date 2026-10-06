import { describe, expect, it } from 'vitest';

import { viewCheckOf } from './view-schema.ts';

describe('the check of a view against its schema', () => {
  it('passes a view the schema allows, and names where one it refuses is wrong', () => {
    const check = viewCheckOf({
      type: 'object',
      additionalProperties: { type: 'array', maxItems: 2 },
    });

    expect([check({ spring: [1] }), check({ spring: [1, 2, 3] }), check([])]).toEqual([
      undefined,
      '/spring: Expected a value with a length of at most 2',
      'the view: Expected object',
    ]);
  });

  it('reads a schema of draft 07, named or told by its definitions, as draft 07', () => {
    const named = viewCheckOf({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'array',
      items: [{ type: 'integer' }],
      additionalItems: false,
    });
    const defined = viewCheckOf({ definitions: { n: { type: 'integer' } }, $ref: '#/definitions/n' });

    expect([named([1]), named([1, 2]) === undefined, defined(1), defined('one') === undefined]).toEqual([
      undefined,
      false,
      undefined,
      false,
    ]);
  });
});
