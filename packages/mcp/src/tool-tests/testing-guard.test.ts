import { describe, expect, it } from 'vitest';

import { canBeTested } from './testing-guard.ts';

const everyTool = { allowed: null, testable: [] };

describe('whether a tool can be tested', () => {
  it('is yes for a tool its server marks read-only, even where it also marks it destructive', () => {
    expect(canBeTested('search', { readOnlyHint: true }, everyTool)).toBe(true);
    expect(canBeTested('search', { readOnlyHint: true, destructiveHint: true }, everyTool)).toBe(true);
  });

  it('is no for a tool with no hints, a tool marked destructive, and one marked only as additive, which still writes', () => {
    expect(canBeTested('execute', undefined, everyTool)).toBe(false);
    expect(canBeTested('execute', {}, everyTool)).toBe(false);
    expect(canBeTested('execute', { readOnlyHint: false, destructiveHint: true }, everyTool)).toBe(false);
    expect(canBeTested('execute', { destructiveHint: false }, everyTool)).toBe(false);
  });

  it('is yes for a tool the entry of its server marks testable by name, whatever its server marks it', () => {
    expect(canBeTested('execute', undefined, { allowed: null, testable: ['execute'] })).toBe(true);
    expect(canBeTested('execute', { destructiveHint: true }, { allowed: null, testable: ['execute'] })).toBe(true);
    expect(canBeTested('execute', undefined, { allowed: null, testable: ['search'] })).toBe(false);
  });

  it('is no for a tool the entry of its server does not allow, however its server marks it', () => {
    const onlyExecute = { allowed: ['execute'], testable: ['execute'] };

    expect(canBeTested('search', { readOnlyHint: true }, onlyExecute)).toBe(false);
    expect(canBeTested('execute', undefined, onlyExecute)).toBe(true);
  });
});
