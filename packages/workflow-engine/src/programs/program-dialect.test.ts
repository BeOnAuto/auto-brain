import { describe, expect, it } from 'vitest';

import { compileProgram } from './program-compiling.ts';
import type { Dialect } from './program-dialect.ts';

const clockless: Dialect = {
  refused: [
    { name: 'now', why: 'reads the clock' },
    { name: 'input', why: 'reads another input' },
    { name: '$ENV', why: 'reads the environment' },
    { name: 'label', why: 'gives wrong answers' },
    { name: 'break', why: 'gives wrong answers' },
  ],
  variables: ['given'],
};

const unchecked: Dialect = { refused: [{ name: 'now', why: 'reads the clock' }] };

function issuesOf(source: string, dialect: Dialect = clockless): readonly string[] {
  const compiled = compileProgram(source, dialect);
  return 'issues' in compiled ? compiled.issues.map(({ detail, span }) => `${span.start}-${span.end} ${detail}`) : [];
}

describe('the functions and the syntax of a dialect', () => {
  it('refuses the functions its caller names, wherever they are called, in the order they appear', () => {
    expect(issuesOf('[.a, now, (1 | input)]')).toEqual(['5-8 now reads the clock', '15-20 input reads another input']);
    expect(issuesOf('def f: now; f')).toEqual(['7-10 now reads the clock']);
    expect(issuesOf('{a: now} | [.a]')).toEqual(['4-7 now reads the clock']);
  });

  it('lets a program call a function of its own of a refused name, of the arity it defines', () => {
    expect(issuesOf('def now: 1; now')).toEqual([]);
    expect(issuesOf('def input(f): f; input(1)')).toEqual([]);
    expect(issuesOf('def input(f): f; input')).toEqual(['17-22 input reads another input']);
    expect(issuesOf('def f(now): now; f(1)')).toEqual([]);
  });

  it('refuses the syntax its caller names, and only that', () => {
    expect(issuesOf('label $out | 1, break $out')).toEqual([
      '0-26 label gives wrong answers',
      '16-26 break gives wrong answers',
    ]);
    expect(issuesOf('label $out | 1', unchecked)).toEqual([]);
  });
});

describe('the variables of a dialect', () => {
  it('refuses a variable its caller names, unless the program binds it', () => {
    expect(issuesOf('$ENV.HOME')).toEqual(['0-4 $ENV reads the environment']);
    expect(issuesOf('1 as $ENV | $ENV')).toEqual([]);
  });

  it('refuses a variable the program does not bind and its caller does not give', () => {
    expect(issuesOf('$__loc__')).toEqual([
      '0-8 $__loc__ is not defined; bind it with as, reduce or foreach before using it',
    ]);
    expect(issuesOf('$given + 1')).toEqual([]);
    expect(issuesOf('$x as $x | $x')).toEqual([
      '0-2 $x is not defined; bind it with as, reduce or foreach before using it',
    ]);
  });

  it('takes the variables a program binds with as, patterns, reduce and foreach, where they are bound', () => {
    expect(issuesOf('. as [$a, {b: $c, $d}] | [$a, $c, $d]')).toEqual([]);
    expect(issuesOf('reduce .[] as $x (0; . + $x)')).toEqual([]);
    expect(issuesOf('foreach .[] as $x (0; . + $x; [$x, .])')).toEqual([]);
    expect(issuesOf('reduce .[] as $x ($x; .)')).toEqual([
      '18-20 $x is not defined; bind it with as, reduce or foreach before using it',
    ]);
    expect(issuesOf('1 as $x | (def f: $x; f)')).toEqual([]);
    expect(issuesOf('def f: $x; 1 as $x | f')).toEqual([
      '7-9 $x is not defined; bind it with as, reduce or foreach before using it',
    ]);
  });

  it('checks no variable when its caller gives none to check against', () => {
    expect(issuesOf('$anything', unchecked)).toEqual([]);
    expect(issuesOf('now', unchecked)).toEqual(['0-3 now reads the clock']);
  });
});
