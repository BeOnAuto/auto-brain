import { describe, expect, it } from 'vitest';

import { isKindWithType, kindsWithTypes, problemTypeOf, reasonOfKind } from '../index.ts';

describe('the types of problems', () => {
  it('are URIs under https://on.auto/problems/', () => {
    expect(problemTypeOf('unavailable')).toBe('https://on.auto/problems/unavailable');
  });

  it('give tools_unfinished and tools_called types of their own, and no other kind', () => {
    expect(kindsWithTypes).toEqual(['tools_unfinished', 'tools_called']);
    expect([
      isKindWithType('tools_unfinished'),
      isKindWithType('tools_called'),
      isKindWithType('tool_not_offered'),
      isKindWithType('toString'),
      isKindWithType(),
    ]).toEqual([true, true, false, false, false]);
  });

  it('keep the reason of each kind with a type of its own', () => {
    expect(kindsWithTypes.map((kind) => reasonOfKind(kind))).toEqual(['unavailable', 'conflict']);
  });
});
