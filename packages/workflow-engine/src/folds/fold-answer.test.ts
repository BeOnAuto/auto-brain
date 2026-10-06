import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { liftedLimits } from '../program-pool/program-pool.ts';
import { foldAnswerOf, foldPageData } from './fold-answer.ts';
import { foldProgress, progressOf } from './fold-progress.ts';

const clock = { now: () => 0, folding: Function.constVoid, checkOf: () => passing };

const someWork: unknown = expect.any(Number);

function passing(): undefined {
  return undefined;
}

const page = {
  events: [{ type: 'noted', data: 2 }],
  views: [{ fold: '. + $event.data', filters: [{ type: 'noted' }], view: 1, events: [0] }],
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

  it('answers that it could not read a page that is not one', () => {
    const data = foldPageData(page);
    const [view] = data.views;

    expect([
      foldAnswerOf({ events: 'not JSON' }, clock),
      foldAnswerOf({ ...data, events: '[1]' }, clock),
      foldAnswerOf({ ...data, views: [{ ...view, view: 'not JSON' }] }, clock),
      foldAnswerOf({ ...data, views: [{ ...view, filters: [1] }] }, clock),
    ]).toEqual([{ ran: 'unreadable' }, { ran: 'unreadable' }, { ran: 'unreadable' }, { ran: 'unreadable' }]);
  });

  it('reads a dialect that binds no variable, and a budget it is not given as none', () => {
    const { pageBudgetMs: _budget, ...data } = foldPageData({ ...page, dialect: { refused: [] } });

    expect(foldAnswerOf(data, clock)).toMatchObject({
      early: false,
      views: [{ view: '3', folded: 1 }],
    });
  });

  it('reads the indexes of the events a view considers, passing over what is not one', () => {
    const data = foldPageData(page);
    const [view] = data.views;

    expect(foldAnswerOf({ ...data, views: [{ ...view, events: [0, 'zero'] }] }, clock)).toMatchObject({
      views: [{ view: '3', folded: 1 }],
    });
  });
});

describe('the budget of a page a worker folds', () => {
  it('counts its budget from when the pool started the page, when the pool says so', () => {
    const late = { ...clock, now: () => 5000 };
    const view = { fold: '. + $event.data', filters: [{ type: 'noted' }], view: 1, events: [0, 1] };
    const twice = { ...page, events: [...page.events, ...page.events], views: [view] };

    expect(foldAnswerOf(foldPageData({ ...page, startedAt: 0 }), late)).toMatchObject({ early: false });
    expect(foldAnswerOf(foldPageData({ ...twice, startedAt: 0 }), late)).toMatchObject({
      early: true,
      views: [{ folded: 1, through: 0 }],
    });
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
