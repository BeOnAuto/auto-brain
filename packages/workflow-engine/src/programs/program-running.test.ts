import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { compileProgram, lineOf, type Program } from './program-compiling.ts';
import type { ProgramLimits, ProgramOptions, ProgramRun } from './program-running.ts';

const lifted: ProgramLimits = {
  mostWork: 64_000_000,
  mostSteps: Number.POSITIVE_INFINITY,
  mostDepth: 10_000,
  mostOutputs: Number.POSITIVE_INFINITY,
  mostValueDepth: 512,
};

const workflowLike: ProgramLimits = {
  mostWork: 8_000_000,
  mostSteps: 200_000,
  mostDepth: 200,
  mostOutputs: 10_000,
  mostValueDepth: Number.POSITIVE_INFINITY,
};

const exactlyOne: ProgramOptions = { limits: lifted, outputs: 'exactly one' };

function programOf(source: string): Program {
  const compiled = compileProgram(source, { refused: [] });
  if ('issues' in compiled) {
    throw new Error(compiled.issues.map(({ detail }) => detail).join('; '));
  }
  return compiled.program;
}

function run(source: string, input: Json = null, options: ProgramOptions = exactlyOne): ProgramRun {
  return programOf(source).run(input, options);
}

describe('compiling a program', () => {
  it('gives the issue of a program that does not parse, with its error and where it is', () => {
    expect(compileProgram('.a +', { refused: [] })).toEqual({
      issues: [{ detail: 'Unexpected token', span: { start: 4, end: 4 }, error: 'ParseError' }],
    });
    expect(compileProgram('"unclosed', { refused: [] })).toMatchObject({ issues: [{ error: 'LexError' }] });
    expect(compileProgram('nope(1)', { refused: [] })).toEqual({
      issues: [{ detail: 'Unknown function: nope', span: { start: 0, end: 7 }, error: 'ValidateError' }],
    });
  });

  it('refuses a program that nests more than 128 levels, the same on any stack, before anything walks it', () => {
    const tooDeep = { detail: 'The program nests more than 128 levels deep' };

    expect(compileProgram(`${'1+'.repeat(5000)}1`, { refused: [] })).toMatchObject({ issues: [tooDeep] });
    expect(compileProgram(`${'('.repeat(5000)}1${')'.repeat(5000)}`, { refused: [] })).toMatchObject({
      issues: [{ ...tooDeep, error: 'ParseError' }],
    });
    expect(compileProgram(`${'['.repeat(127)}1${']'.repeat(127)}`, { refused: [] })).toHaveProperty('program');
    expect(compileProgram(`${'['.repeat(128)}1${']'.repeat(128)}`, { refused: [] })).toMatchObject({
      issues: [tooDeep],
    });
  });

  it.each([
    ['definitions', `${'def f: 1; '.repeat(200)}1`],
    ['bindings', `${'. as $v | '.repeat(200)}1`],
    ['negations', `${'-'.repeat(200)}1`],
    ['assignments', `${'.a = '.repeat(200)}1`],
    ['patterns', `. as ${'['.repeat(200)}$v${']'.repeat(200)} | 1`],
  ])('counts a chain of %s as nesting', (_chain, source) => {
    expect(compileProgram(source, { refused: [] })).toMatchObject({
      issues: [{ detail: 'The program nests more than 128 levels deep', error: 'ParseError' }],
    });
  });

  it('finds the line of a place in the program', () => {
    expect(lineOf('.a\n| .b\n| error("x")', 10)).toBe(3);
    expect(lineOf('.a', 0)).toBe(1);
  });
});

describe('a program that must give exactly one output', () => {
  it('answers its one output, with the work it did', () => {
    expect(run('.a + 1', { a: 1 })).toEqual({ ran: 'answered', value: 2, work: 544 });
  });

  it('answers that it gave none, or more than one, and stops after the second', () => {
    expect(run('empty')).toMatchObject({ ran: 'unanswered', outputs: 0 });
    expect(run('1, 2')).toMatchObject({ ran: 'unanswered', outputs: 2 });
    expect(run('1, 2, error("never reached")')).toMatchObject({ ran: 'unanswered', outputs: 2 });
    expect(run('1, error("reached")')).toMatchObject({ ran: 'raised', issue: { detail: 'reached' } });
  });

  it('answers the error it raised, and where', () => {
    expect(run('.a | error("stop")', { a: 1 })).toMatchObject({
      ran: 'raised',
      issue: { detail: 'stop', span: { start: 5, end: 18 }, error: 'RuntimeError' },
    });
    expect(run('.a + 1', { a: 'x' })).toMatchObject({
      ran: 'raised',
      issue: { detail: 'Cannot add string and number', error: 'RuntimeError' },
    });
  });

  it('answers that a number it gave cannot be carried as JSON', () => {
    expect(run('nan')).toMatchObject({ ran: 'unfit' });
    expect(run('[infinite]')).toMatchObject({ ran: 'unfit' });
  });
});

describe('the first output of a program', () => {
  it('is null when there is none, and the first of several', () => {
    const first: ProgramOptions = { limits: workflowLike, outputs: 'first' };

    expect(run('empty', null, first)).toMatchObject({ ran: 'answered', value: null });
    expect(run('1, 2', null, first)).toMatchObject({ ran: 'answered', value: 1 });
  });
});

describe('the limits of a run', () => {
  it('stop it once it has done the most work it may, with the work it did, and no try catches that', () => {
    const exhausted = run('try ("x" * 100000000) catch "caught"');

    expect(exhausted).toMatchObject({ ran: 'exhausted', limit: 'work', issue: { detail: 'Work limit exceeded' } });
    expect(exhausted.work).toBeGreaterThan(64_000_000);
  });

  it('stop it when an answer shares its values so often that visiting it would take more than its work', () => {
    expect(run('reduce range(30) as $i (0; [., .])')).toMatchObject({
      ran: 'exhausted',
      limit: 'work',
      issue: { detail: 'Work limit exceeded', span: { start: 0, end: 0 } },
    });
  });

  it('stop it at its deadline, read on the clock it is given', () => {
    const readings = { count: 0 };
    const clock = (): number => {
      readings.count += 1;
      return readings.count;
    };

    expect(
      run('[range(100000)] | length', null, { ...exactlyOne, deadline: { milliseconds: 5, clock } }),
    ).toMatchObject({ ran: 'exhausted', limit: 'deadline', issue: { detail: 'Deadline exceeded' } });
  });

  it('can be lifted, so a run gives more values and takes more steps than an expression may', () => {
    expect(run('[range(20000)] | length')).toMatchObject({ ran: 'answered', value: 20_000 });
    expect(run('reduce range(100000) as $i (0; . + 1)')).toMatchObject({ ran: 'answered', value: 100_000 });
    expect(run('[range(20000)] | length', null, { limits: workflowLike, outputs: 'first' })).toMatchObject({
      ran: 'raised',
      issue: { detail: 'Output limit exceeded' },
    });
  });

  it('bound how deep its evaluation nests', () => {
    const recursion = 'def f: if . == 0 then 0 else (. - 1 | f) + 1 end; f';

    expect(run(recursion, 30)).toMatchObject({ ran: 'answered', value: 30 });
    expect(run(recursion, 100, { ...exactlyOne, limits: { ...lifted, mostDepth: 100 } })).toMatchObject({
      ran: 'raised',
      issue: { detail: 'Max depth exceeded' },
    });
  });
});

describe('the depth of a value', () => {
  it.each([
    ['an array it builds', 'reduce range(600) as $i (null; [.])'],
    ['an object it builds', 'reduce range(600) as $i (null; {a: .})'],
    ['a value it reads as JSON', '("[" * 600) + ("]" * 600) | fromjson'],
    ['a path it sets', '[range(600) | 0] as $p | null | setpath($p; 1)'],
    ['the entries of entries', 'reduce range(600) as $i ({a: 1}; {b: .}) | to_entries'],
    ['a value it catches', 'try (reduce range(600) as $i (null; [.])) catch 1'],
  ])('stops a run at 512 levels in %s, and no try catches that', (_where, source) => {
    expect(run(source)).toMatchObject({ ran: 'exhausted', limit: 'value depth' });
  });

  it('is not bounded below 512 levels, nor when the run lifts it', () => {
    expect(run('reduce range(511) as $i (null; [.]) | length')).toMatchObject({ ran: 'answered', value: 1 });
    expect(
      run('reduce range(600) as $i (null; [.]) | length', null, { limits: workflowLike, outputs: 'first' }),
    ).toMatchObject({ ran: 'answered', value: 1 });
  });
});

describe('a loop', () => {
  it.each([
    ['until', '50000 | until(. == 0; . - 1)', 0],
    ['while', '[0 | while(. < 50000; . + 1)] | length', 50_000],
    ['recurse with a filter', '[0 | recurse(if . < 50000 then . + 1 else empty end)] | length', 50_001],
    ['recurse with a condition', '[0 | recurse(. + 1; . < 50000)] | length', 50_001],
  ])('of %s runs as long as its work allows, taking no stack and no depth', (_loop, source, value) => {
    expect(run(source)).toMatchObject({ ran: 'answered', value });
  });

  it('gives its values in the order a recursive loop gives them', () => {
    expect(run('[0 | until(. > 3; . + 1, . + 2)]')).toMatchObject({ ran: 'answered', value: [4, 5, 4, 4, 5, 4, 5, 4] });
    expect(run('[0 | while(. < 3; . + 1, . + 2)]')).toMatchObject({ ran: 'answered', value: [0, 1, 2, 2] });
    expect(run('[1 | recurse(if . < 4 then . + 1, . + 2 else empty end)]')).toMatchObject({
      ran: 'answered',
      value: [1, 2, 3, 4, 5, 4, 3, 4, 5],
    });
    expect(run('[2 | recurse(. + 1; . < 6)]')).toMatchObject({ ran: 'answered', value: [2, 3, 4, 5, 6] });
    expect(run('[{b: [2, {c: 3}], a: 1} | recurse]')).toMatchObject({
      ran: 'answered',
      value: [{ b: [2, { c: 3 }], a: 1 }, 1, [2, { c: 3 }], 2, { c: 3 }, 3],
    });
  });

  it('gives back the depth of what it stopped early, so a loop cut short takes none', () => {
    const workflow: ProgramOptions = { limits: workflowLike, outputs: 'first' };

    expect(run('[range(300) | first(0 | until(. > 3; . + 1, . + 2))] | length', null, workflow)).toMatchObject({
      ran: 'answered',
      value: 300,
    });
    expect(run('[limit(250; 0 | recurse(. + 1))] | length', null, workflow)).toMatchObject({
      ran: 'answered',
      value: 250,
    });
    expect(run('[range(300) | try (0 | until(. > 3; error("x"))) catch 1] | length', null, workflow)).toMatchObject({
      ran: 'answered',
      value: 300,
    });
  });
});

describe('what a program sees', () => {
  it('is its input, the variables and the time it is given', () => {
    const input = { a: [1, 2] };
    const options: ProgramOptions = { ...exactlyOne, variables: { b: 3 }, now: 1_790_845_200_000 };

    expect(run('[.a[], $b, (now | todate)]', input, options)).toMatchObject({
      ran: 'answered',
      value: [1, 2, 3, '2026-10-01T09:00:00Z'],
    });
    expect(run('.a | length', input)).toMatchObject({ ran: 'answered', value: 2 });
  });
});
