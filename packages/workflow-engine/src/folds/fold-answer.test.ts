import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { liftedLimits } from '../program-pool/program-pool.ts';
import { compileProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import { foldAnswerOf, foldPageData } from './fold-answer.ts';
import type { FoldHost } from './fold-page.ts';
import { foldProgress, progressOf } from './fold-progress.ts';

const clock: FoldHost = { now: () => 0, folding: Function.constVoid, checkOf: () => passing, compile: compileProgram };

const someWork: unknown = expect.any(Number);

function passing(): undefined {
  return undefined;
}

const adding = { fold: '. + $event.data', filters: [{ type: 'noted' }], view: 1, events: [0] };

const page = {
  events: [{ type: 'noted', data: 2 }],
  views: [adding],
  dialect: { refused: [{ name: 'now', why: 'reads the clock' }], variables: ['event'] },
  variable: 'event',
  limits: liftedLimits(16_000_000),
  foldDeadlineMs: 10_000,
  pageBudgetMs: 2000,
  mostViewBytes: 1000,
};

describe('the answer of a worker that folds a page', () => {
  it('folds the page it is given, as the page crosses to it, and answers each view as JSON text', () => {
    expect(foldAnswerOf(foldPageData(page), clock)).toEqual({
      ran: 'folded',
      early: false,
      views: [{ view: '3', folded: 1, lastFolded: 0, through: 0, work: someWork }],
    });
  });

  it('answers that it could not read a page whose events or views are not the JSON a page crosses as', () => {
    const data = foldPageData(page);
    const tooDeep = `[{"data":${'['.repeat(600)}${']'.repeat(600)}}]`;

    expect([
      foldAnswerOf({ ...data, events: 'not JSON' }, clock),
      foldAnswerOf({ ...data, events: '[1]' }, clock),
      foldAnswerOf({ ...data, events: tooDeep }, clock),
      foldAnswerOf({ ...data, views: [{ ...adding, view: 'not JSON' }] }, clock),
    ]).toEqual([{ ran: 'unreadable' }, { ran: 'unreadable' }, { ran: 'unreadable' }, { ran: 'unreadable' }]);
  });

  it('compiles each fold and each test of a filter once a page, with the compiler its host gives', () => {
    const compiled: string[] = [];
    const counting: FoldHost = {
      ...clock,
      compile: (source: string, dialect: Dialect) => {
        compiled.push(source);
        return compileProgram(source, dialect);
      },
    };
    const tested = {
      ...page,
      events: [...page.events, ...page.events],
      views: [{ ...adding, filters: [{ type: 'noted', data: '${ . > 1 }' }], events: [0, 1] }],
    };

    expect(foldAnswerOf(foldPageData(tested), counting)).toMatchObject({ views: [{ view: '5', folded: 2 }] });
    expect(compiled).toEqual(['. + $event.data', ' . > 1 ']);
  });
});

describe('the budget of a page a worker folds', () => {
  it('counts from its first fold, so what the worker does before it folds never spends it', () => {
    const time = { now: 0 };
    const slowToPrepare: FoldHost = {
      ...clock,
      now: () => time.now,
      checkOf: () => {
        time.now += 5000;
        return passing;
      },
    };
    const view = { fold: '. + $event.data', filters: [{ type: 'noted' }], view: 1, schema: {}, events: [0, 1] };
    const twice = { ...page, events: [...page.events, ...page.events], views: [view] };

    expect(foldAnswerOf(foldPageData(twice), slowToPrepare)).toMatchObject({
      early: false,
      views: [{ view: '5', folded: 2, through: 1 }],
    });
  });
});

describe('the progress of a page of folds', () => {
  it('names the last fold marked, through memory shared with the worker, and nothing before one was', () => {
    const progress = foldProgress();
    const seen = progressOf(progress.shared);

    const before = progress.last();
    seen.mark(4, 2);

    expect([before, progress.last()]).toEqual([undefined, { event: 4, view: 2 }]);
  });
});
