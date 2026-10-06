import { describe, expect, it } from 'vitest';

import { isKindWithType, kindsWithTypes, problemTypeOf } from '../index.ts';

describe('the types of problems', () => {
  it('are URIs under https://on.auto/problems/', () => {
    expect(problemTypeOf('unavailable')).toBe('https://on.auto/problems/unavailable');
  });

  it('give tools_unfinished a type of its own, and no other kind', () => {
    expect(kindsWithTypes).toEqual(['tools_unfinished']);
    expect([
      isKindWithType('tools_unfinished'),
      isKindWithType('tool_not_offered'),
      isKindWithType('tools_called'),
      isKindWithType(),
    ]).toEqual([true, false, false, false]);
  });
});
