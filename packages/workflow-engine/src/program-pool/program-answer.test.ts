import { describe, expect, it } from 'vitest';

import { answerOf } from './program-answer.ts';
import { liftedLimits } from './program-pool.ts';

const clock = (): number => 0;

const request = {
  source: '[.[] | . + 1]',
  input: '[1, 2]',
  dialect: { refused: [], variables: [] },
  limits: liftedLimits(64_000_000),
  deadlineAt: 10_000,
  mostOutputBytes: 1000,
};

describe('the answer of a worker', () => {
  it('runs the program it is given on the input it is given', () => {
    expect(answerOf(request, clock)).toEqual({ ran: 'answered', output: '[2,3]', bytes: 5, work: 1392 });
  });

  it('checks the variables of the program only when its dialect gives the ones it may use', () => {
    const unbound = { ...request, source: '[.[] | . + $n]' };

    expect(answerOf(unbound, clock)).toMatchObject({
      ran: 'refused',
      issues: [{ detail: '$n is not defined; bind it with as, reduce or foreach before using it' }],
    });
    expect(answerOf({ ...unbound, dialect: { refused: [] } }, clock)).toMatchObject({
      ran: 'raised',
      issue: { detail: 'Undefined variable: n' },
    });
  });

  it('binds the variables it is given, and reads variables that are not an object as too deep to take', () => {
    const bound = { ...request, source: '[.[] | . + $n]', dialect: { refused: [], variables: ['n'] } };

    expect(answerOf({ ...bound, variables: '{"n": 10}' }, clock)).toMatchObject({ ran: 'answered', output: '[11,12]' });
    expect(answerOf({ ...bound, variables: '[1]' }, clock)).toMatchObject({ ran: 'exhausted', limit: 'value depth' });
  });

  it('reads what it is not given as nothing', () => {
    expect(answerOf({}, clock)).toMatchObject({ ran: 'refused', issues: [{ error: 'ParseError' }] });
    expect(answerOf({ source: '.', input: '1', limits: {} }, clock)).toMatchObject({
      ran: 'raised',
      issue: { detail: 'Step limit exceeded' },
    });
  });
});
