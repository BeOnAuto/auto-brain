import { describe, expect, it } from 'vitest';

import { outputCheckOf, viewCheckOf } from './value-checks.ts';

describe('the check of an answer against the output schema', () => {
  it('names at most three issues of the output', () => {
    const check = outputCheckOf({ type: 'array', items: { type: 'string' } });

    expect(check([1, 2, 3, 4])).toEqual([
      { pointer: '/0', detail: 'Expected string' },
      { pointer: '/1', detail: 'Expected string' },
      { pointer: '/2', detail: 'Expected string' },
    ]);
    expect(check(['x'])).toEqual([]);
  });

  it('refuses every output when the schema it is given does not compile, naming why', () => {
    expect(outputCheckOf('not a schema')(1)).toEqual([{ pointer: '', detail: 'A schema is a JSON object' }]);
  });
});

describe('the check of a view against the view schema', () => {
  it('says nothing of a view that matches, and names where one does not', () => {
    const check = viewCheckOf({ type: 'object', additionalProperties: { type: 'array', maxItems: 1 } });

    expect(check({ spring: [1] })).toBeUndefined();
    expect(check([])).toBe('the view: Expected object');
    expect(check({ spring: [1, 2], autumn: [1, 2] })).toBe(
      '/spring: Expected a value with a length of at most 1; /autumn: Expected a value with a length of at most 1',
    );
  });
});
