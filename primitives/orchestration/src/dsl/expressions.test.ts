import { describe, expect, it } from 'vitest';

import { checkExpression, enclosedBody, expressionSource, runExpression } from './expressions.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

describe('an expression', () => {
  it('is the body of a string enclosed in ${ }', () => {
    expect(enclosedBody('${ .name }')).toBe(' .name ');
    expect(enclosedBody('  ${.a}  ')).toBe('.a');
    expect(enclosedBody('.name')).toBeUndefined();
    expect(enclosedBody(3)).toBeUndefined();
    expect(expressionSource('${ .a }')).toBe(' .a ');
    expect(expressionSource('.a')).toBe('.a');
  });

  it('runs as jq on the data, with variables, and gives its first output', () => {
    expect(runExpression('.a + $b', { a: 1 }, { b: 2 }, now)).toEqual({ value: 3 });
    expect(runExpression('.[]', [4, 5], {}, now)).toEqual({ value: 4 });
    expect(runExpression('empty', null, {}, now)).toEqual({ value: null });
  });

  it('runs again on the same variables', () => {
    const variables = { context: { list: [1, 2, 3] } };

    expect(runExpression('$context.list | length', null, variables, now)).toEqual({ value: 3 });
    expect(runExpression('$context.list | add', null, variables, now)).toEqual({ value: 6 });
  });
});

describe('the time of an expression', () => {
  it('is the time it is given, never the host clock', () => {
    expect(runExpression('now | todate', null, {}, now)).toEqual({ value: '2026-10-01T09:00:00Z' });
  });

  it.each([
    ['now | localtime', 'localtime'],
    ['now | strflocaltime("%H")', 'strflocaltime'],
  ])('rejects %s, which reads the time zone of the host', (expression, builtin) => {
    expect(checkExpression(expression)).toBe(
      `${expression}: ${builtin} reads the host's time zone, so it is not deterministic; use the UTC builtins`,
    );
  });

  it('allows the UTC date builtins', () => {
    expect(checkExpression('now | gmtime | mktime | strftime("%Y")')).toBeUndefined();
  });
});

describe('a failing expression', () => {
  it('gives a problem when it fails to run', () => {
    expect(runExpression('.a + 1', { a: 'text' }, {}, now)).toEqual({
      problem: '.a + 1: RuntimeError: Cannot add string and number',
    });
    expect(runExpression('error("stop")', null, {}, now)).toEqual({ problem: 'error("stop"): RuntimeError: stop' });
  });

  it('gives a problem when it gives what JSON cannot carry', () => {
    expect(runExpression('nan', null, {}, now)).toEqual({ problem: 'nan gave a value that is not JSON' });
  });

  it('gives a problem when it does not parse, and the same problem when run', () => {
    expect(checkExpression('.a +')).toBe('.a +: ParseError: Unexpected token');
    expect(runExpression('.a +', null, {}, now)).toEqual({ problem: '.a +: ParseError: Unexpected token' });
    expect(checkExpression('undefined_builtin')).toBe(
      'undefined_builtin: ValidateError: Unknown function: undefined_builtin',
    );
    expect(checkExpression('.a | length')).toBeUndefined();
  });
});
