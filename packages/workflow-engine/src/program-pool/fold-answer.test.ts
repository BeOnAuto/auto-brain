import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { foldAnswerOf, foldPageData } from './fold-answer.ts';
import { foldProgress, progressOf } from './fold-progress.ts';
import { liftedLimits } from './program-pool.ts';

const clock = { now: () => 0, folding: Function.constVoid };

const someWork: unknown = expect.any(Number);

const page = {
  events: [{ type: 'noted', data: 2 }],
  views: [{ fold: '. + $event.data', filters: [{ type: 'noted' }], view: 1, events: [0] }],
  dialect: { refused: [], variables: ['event'] },
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
      through: 0,
      early: false,
      views: [{ view: '3', folded: 1, lastFolded: 0, work: someWork }],
    });
  });

  it('answers that it could not read a page that is not one', () => {
    expect(foldAnswerOf({ events: 'not JSON' }, clock)).toEqual({ ran: 'unreadable' });
  });
});

describe('the progress of a page of folds', () => {
  it('names the last fold marked, through memory shared with the worker, and nothing before one was', () => {
    const progress = foldProgress();
    const seen = progressOf({ progress: { shared: progress.shared } });

    const before = progress.last();
    seen.mark(4, 2);

    expect([before, progress.last(), progressOf({}).last()]).toEqual([undefined, { event: 4, view: 2 }, undefined]);
  });
});
