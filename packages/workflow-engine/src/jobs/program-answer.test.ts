import { describe, expect, it } from 'vitest';

import { liftedLimits } from '../program-pool/program-pool.ts';
import { compileProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import { answerOf, unchecked, type OutputIssue, type ProgramHost } from './program-answer.ts';
import type { ProgramJob } from './program-messages.ts';

const host: ProgramHost = { now: () => 0, compile: compileProgram, check: unchecked };

const request: ProgramJob = {
  source: '[.[] | . + 1]',
  input: '[1, 2]',
  variables: '{}',
  dialect: { refused: [], variables: [] },
  limits: liftedLimits(64_000_000),
  deadlineAt: 10_000,
  mostOutputBytes: 1000,
  context: null,
};

describe('the answer of a worker', () => {
  it('runs the program it is given on the input it is given', () => {
    expect(answerOf(request, host)).toEqual({ ran: 'answered', output: '[2,3]', bytes: 5, work: 1392 });
  });

  it('checks the variables of the program only when its dialect gives the ones it may use', () => {
    const unbound = { ...request, source: '[.[] | . + $n]' };

    expect(answerOf(unbound, host)).toMatchObject({
      ran: 'refused',
      issues: [{ detail: '$n is not defined; bind it with as, reduce or foreach before using it' }],
    });
    expect(answerOf({ ...unbound, dialect: { refused: [] } }, host)).toMatchObject({
      ran: 'raised',
      issue: { detail: 'Undefined variable: n' },
    });
  });

  it('binds the variables it is given, and reads variables that are not an object as too deep to take', () => {
    const bound = { ...request, source: '[.[] | . + $n]', dialect: { refused: [], variables: ['n'] } };

    expect(answerOf({ ...bound, variables: '{"n": 10}' }, host)).toMatchObject({ ran: 'answered', output: '[11,12]' });
    expect(answerOf({ ...bound, variables: '[1]' }, host)).toMatchObject({ ran: 'exhausted', limit: 'value depth' });
  });

  it('compiles the program with the compiler its host gives, so a worker can keep what it compiled', () => {
    const compiled: string[] = [];
    const counting: ProgramHost = {
      ...host,
      compile: (source: string, dialect: Dialect) => {
        compiled.push(source);
        return compileProgram(source, dialect);
      },
    };

    answerOf(request, counting);

    expect(compiled).toEqual([request.source]);
  });
});

function refusing(output: unknown): readonly OutputIssue[] {
  return [
    { pointer: `/${'k'.repeat(2000)}`, detail: 'Expected no excess property' },
    { pointer: '', detail: `got ${JSON.stringify(output)} ${'x'.repeat(2000)}` },
  ];
}

describe('the answer of a worker that checks the output', () => {
  it('answers the output when the check finds nothing, and the issues it finds when it does, the pointer and the detail of each cut at 1,024 bytes apart', () => {
    expect(answerOf(request, host)).toMatchObject({ ran: 'answered', output: '[2,3]' });
    expect(answerOf(request, { ...host, check: refusing })).toEqual({
      ran: 'mismatched',
      issues: [
        { pointer: `/${'k'.repeat(1023)}…`, detail: 'Expected no excess property' },
        { pointer: '', detail: `got [2,3] ${'x'.repeat(1014)}…` },
      ],
      work: 1392,
    });
  });
});
