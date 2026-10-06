import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { compileProgram } from './program-compiling.ts';
import type { ProgramLimits, ProgramRun } from './program-running.ts';

const lifted: ProgramLimits = {
  mostWork: 64_000_000,
  mostSteps: Number.POSITIVE_INFINITY,
  mostDepth: 10_000,
  mostOutputs: Number.POSITIVE_INFINITY,
  mostValueDepth: 512,
};

const tooDeepAPattern = 'regex too large: groups nested more than 128 deep';

function run(source: string, input: Json = null, limits: ProgramLimits = lifted): ProgramRun {
  const compiled = compileProgram(source, { refused: [] });
  if ('issues' in compiled) {
    throw new Error(compiled.issues.map(({ detail }) => detail).join('; '));
  }
  return compiled.program.run(input, { limits, outputs: 'exactly one' });
}

function nestedGroups(count: number): string {
  return `"a" | test(("(" * ${count}) + "a" + (")" * ${count}))`;
}

describe('a regular expression whose groups nest deeply, on the main thread', () => {
  it('may nest 128 groups, and is refused past them as too large, an error try can catch', () => {
    expect(run(nestedGroups(128))).toMatchObject({ ran: 'answered', value: true });
    expect(run(nestedGroups(129))).toMatchObject({ ran: 'raised', issue: { detail: tooDeepAPattern } });
  });

  it('is refused before its parser recurses, so 77,354 groups answer the same on every stack', () => {
    expect(run(`try (${nestedGroups(77_354)}) catch .`)).toMatchObject({ ran: 'answered', value: tooDeepAPattern });
  });
});

describe('a run that overflows the stack of its thread', () => {
  it('is exhausted by the stack, which try cannot catch, never answered with the overflow as a value', () => {
    const recursion = 'def g: if . == 0 then 0 else (. - 1 | g) end;';
    const unbounded = { ...lifted, mostDepth: Number.POSITIVE_INFINITY };

    expect(run(`${recursion} try (1000000 | g) catch "caught"`, null, unbounded)).toMatchObject({
      ran: 'exhausted',
      limit: 'stack',
      issue: { error: 'RangeError' },
    });
  });

  it('is exhausted by the stack when its input is a value the host cannot walk', () => {
    const cyclic: Json[] = [];
    cyclic.push(cyclic);

    expect(run('.', cyclic)).toMatchObject({ ran: 'exhausted', limit: 'stack', issue: { span: { start: 0, end: 0 } } });
  });
});
