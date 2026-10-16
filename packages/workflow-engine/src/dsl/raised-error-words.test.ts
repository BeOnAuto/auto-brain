import type { Issue } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { callErrorOf, describeError, errorAsJson, errorFromJson, errorType, settlementOf } from './raised-error.ts';

const site = { function: 'notify', label: 'the function notify', reference: '/do/0/ask' };

const runtime = errorType('runtime');

describe('the words of an error', () => {
  it('say its detail first, then the step that raised it by the name the document gives it, then its title', () => {
    const refused = callErrorOf(
      { status: 'rejected', reason: 'invalid_input', detail: 'seats, how many seats: expected at least 1.' },
      { function: 'book', label: 'the computation function book', reference: '/do/0/work-out-seats' },
    );

    expect(describeError(refused)).toBe(
      'seats, how many seats: expected at least 1, at the step work-out-seats. The computation function book rejected the run with invalid_input.',
    );
  });

  it('name the innermost step of a pointer within the steps, however deep, and never the pointer', () => {
    expect(
      [
        '/do/0/lookup/try/0/fetch',
        '/do/1/review/catch/do/0/give-up',
        '/do/0/all/fork/branches/2/notify~1team',
        '/do/0/each/do/1/total',
        '/do/0/do/do/0/inner',
        '/do/2/wait/listen/to/one',
      ].map((instance) => describeError({ type: runtime, status: 500, title: 'It broke', instance })),
    ).toEqual([
      'It broke, at the step fetch.',
      'It broke, at the step give-up.',
      'It broke, at the step notify/team.',
      'It broke, at the step total.',
      'It broke, at the step inner.',
      'It broke, at the step wait.',
    ]);
  });

  it('say the place of an error outside the steps as its pointer, and nothing of an error of the whole workflow', () => {
    expect([
      describeError({
        type: runtime,
        status: 400,
        title: 'An expression failed',
        detail: 'No b.',
        instance: '/schedule/on/any/0',
      }),
      describeError({ type: runtime, status: 500, title: 'It ran too long.', instance: '/' }),
      describeError({ type: runtime, status: 500, instance: '' }),
    ]).toEqual(['No b, at /schedule/on/any/0. An expression failed.', 'It ran too long.', `${runtime}.`]);
  });
});

describe('the issues of a refused input a step met', () => {
  it('carries the issues of a refused input, each at its pointer and in its sentence, into the rejection of the run', () => {
    const issues: readonly Issue[] = [
      { pointer: '/input/seats', detail: 'seats, how many seats: expected at least 1.' },
      { pointer: '/input/day', detail: 'day: expected text in the form the schema calls date.' },
    ];
    const refused = callErrorOf(
      { status: 'rejected', reason: 'invalid_input', detail: issues.map(({ detail }) => detail).join(' '), issues },
      site,
    );

    expect(errorAsJson(refused)).toMatchObject({ status: 400, issues });
    expect(settlementOf({ kind: 'raised', error: refused })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'seats, how many seats: expected at least 1. day: expected text in the form the schema calls date, at the step ask. The function notify rejected the run with invalid_input.',
      issues,
    });
    expect(settlementOf({ kind: 'raised', error: { ...refused, status: 503 } })).not.toHaveProperty('issues');
  });

  it('raises the issues an error names again, and none that are not a list of issues', () => {
    const issues = [{ pointer: '/input/seats', detail: 'seats: expected at least 1.' }];

    expect([
      errorFromJson({ type: 'refused', status: 400, issues }, '/do/0/report'),
      errorFromJson({ type: 'refused', status: 400, issues: 'seats' }, '/do/0/report'),
    ]).toEqual([
      { type: 'refused', status: 400, instance: '/do/0/report', issues },
      { type: 'refused', status: 400, instance: '/do/0/report' },
    ]);
  });
});
