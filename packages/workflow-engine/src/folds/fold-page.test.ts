import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { liftedLimits } from '../program-pool/program-pool.ts';
import { foldPage, type FoldClock, type FoldPage, type FoldingView } from './fold-page.ts';

const foldDialect = {
  refused: [
    { name: 'now', why: 'reads the clock' },
    { name: '$ARGS', why: 'reads arguments a fold is never given' },
  ],
  variables: ['event'],
};

const reviewed = { type: 'execution_succeeded', subject: 'inference/review-brief' };

function succeeded(campaign: Json, verdict: Json, time: string): JsonObject {
  return { ...reviewed, source: '/executions/run', time, data: { output: { campaign, verdict } } };
}

const events: readonly JsonObject[] = [
  succeeded('spring', 'approve', '2026-10-01T09:00:00Z'),
  { type: 'execution_started', subject: 'inference/review-brief', time: '2026-10-01T09:00:01Z', data: {} },
  succeeded('summer', 'reject', '2026-10-01T09:00:02Z'),
  succeeded('spring', 'reject', '2026-10-01T09:00:03Z'),
];

const byCampaign = '.[$event.data.output.campaign] += [{ at: $event.time, verdict: $event.data.output.verdict }]';

function viewOf(fold: string, more: Partial<FoldingView> = {}): FoldingView {
  return { fold, filters: [reviewed], view: {}, events: [0, 1, 2, 3], ...more };
}

function pageOf(views: readonly FoldingView[], more: Partial<FoldPage> = {}): FoldPage {
  return {
    events,
    views,
    dialect: foldDialect,
    variable: 'event',
    limits: liftedLimits(16_000_000),
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    ...more,
  };
}

function stillClock(): FoldClock & { readonly marks: readonly string[] } {
  const marks: string[] = [];
  return {
    marks,
    now: () => 0,
    folding: (event, view) => {
      marks.push(`${event}:${view}`);
    },
  };
}

function slowFirstFold(stepMs: number): FoldClock {
  const time = { now: 0, slow: false };
  return {
    now: () => {
      time.now += time.slow ? stepMs : 0;
      return time.now;
    },
    folding: (event, view) => {
      time.slow = event === 0 && view === 0;
    },
  };
}

function runningClock(stepMs: number): FoldClock {
  const time = { now: 0 };
  return {
    now: () => {
      time.now += stepMs;
      return time.now;
    },
    folding: Function.constVoid,
  };
}

describe('a page of folds', () => {
  it('folds each event a view considers and its filters match, in order, with the event bound as $event', () => {
    const clock = stillClock();

    const folded = foldPage(pageOf([viewOf(byCampaign), viewOf('. + 1', { view: 0, events: [2, 3] })]), clock);

    expect(folded).toMatchObject({
      through: 3,
      early: false,
      views: [
        {
          view: {
            spring: [
              { at: '2026-10-01T09:00:00Z', verdict: 'approve' },
              { at: '2026-10-01T09:00:03Z', verdict: 'reject' },
            ],
            summer: [{ at: '2026-10-01T09:00:02Z', verdict: 'reject' }],
          },
          folded: 3,
          lastFolded: 3,
        },
        { view: 2, folded: 2, lastFolded: 3 },
      ],
    });
    expect(clock.marks).toEqual(['0:0', '2:0', '2:1', '3:0', '3:1']);
  });

  it('matches a filter by its source, subject and data, and leaves out an event whose data the filter cannot test', () => {
    const filters = [
      {
        type: 'execution_succeeded',
        subject: 'inference/review-brief',
        data: '${ .output.verdict | ascii_upcase == "REJECT" }',
      },
    ];
    const withNumber = [...events, succeeded('autumn', 7, '2026-10-01T09:00:04Z')];

    const folded = foldPage(
      pageOf([viewOf('. + 1', { view: 0, filters, events: [0, 1, 2, 3, 4] })], { events: withNumber }),
      stillClock(),
    );

    expect(folded.views[0]).toMatchObject({ view: 2, folded: 2, lastFolded: 3 });
  });
});

describe('the events a page of folds folds', () => {
  it('never matches a filter that names no type', () => {
    const folded = foldPage(
      pageOf([viewOf('. + 1', { view: 0, filters: [{ subject: 'inference/review-brief' }] })]),
      stillClock(),
    );

    expect(folded.views[0]).toMatchObject({ view: 0, folded: 0 });
  });

  it('keeps a view as it was when no event of the page is one it considers', () => {
    expect(foldPage(pageOf([viewOf(byCampaign, { events: [] })]), stillClock()).views[0]).toEqual({
      view: {},
      folded: 0,
      lastFolded: -1,
      work: 0,
    });
    expect(foldPage(pageOf([], { events: [] }), stillClock())).toEqual({ through: -1, early: false, views: [] });
  });

  it('ends early, between two events, once its budget of time is spent, every view having considered the same events', () => {
    const folded = foldPage(pageOf([viewOf('. + 1', { view: 0 })], { pageBudgetMs: 5 }), runningClock(3));

    expect(folded).toMatchObject({ through: 0, early: true, views: [{ view: 1, folded: 1, lastFolded: 0 }] });
  });
});

const refusedArgs: unknown = expect.stringContaining('$ARGS reads arguments');

const unboundInput: unknown = expect.stringContaining('$input is not defined');

describe('a view that stalls in a page of folds', () => {
  it.each<readonly [string, string, Json, Readonly<Record<string, unknown>>]>([
    [
      'raises',
      '. as $v | error("no campaign")',
      {},
      { kind: 'raised', message: 'no campaign', span: { start: 10, end: 30 } },
    ],
    ['gives no output', 'empty', {}, { kind: 'none', message: 'The fold gave 0 outputs' }],
    ['gives two outputs', '., .', {}, { kind: 'several', message: 'The fold gave 2 outputs' }],
    ['does too much work', '"x" * 20000000', {}, { kind: 'work', message: 'Work limit exceeded' }],
    ['nests a value too deep', 'reduce range(600) as $i (.; [.])', {}, { kind: 'depth' }],
    ['answers what JSON cannot carry', 'nan', {}, { kind: 'unfit' }],
    [
      'outgrows its bound',
      '"x" * 600000',
      {},
      { kind: 'size', message: 'The view takes 600002 bytes as JSON, more than the 524288 it may' },
    ],
    ['uses what its dialect refuses', '. + $ARGS', 0, { kind: 'refused', message: refusedArgs }],
  ])('stalls at the event when its fold %s, never folding another', (_ending, fold, view, stall) => {
    const folded = foldPage(pageOf([viewOf(fold, { view }), viewOf('. + 1', { view: 0 })]), stillClock());

    expect(folded.views[0]).toMatchObject({ view, folded: 0, lastFolded: -1, stall: { at: 0, ...stall } });
    expect(folded.views[1]).toMatchObject({ view: 3, folded: 3 });
  });
});

describe('a view that stalls on what its fold answers', () => {
  it('stalls when the view it answers is not what the view schema allows, keeping the view before', () => {
    const schema = { type: 'object', maxProperties: 1 };

    const folded = foldPage(pageOf([viewOf(byCampaign, { schema })]), stillClock());

    expect(folded.views[0]).toMatchObject({
      folded: 1,
      lastFolded: 0,
      view: { spring: [{ verdict: 'approve' }] },
      stall: { at: 2, kind: 'schema', message: 'the view: Expected a value with at most 1 entry' },
    });
  });

  it('cuts the message of a stall at a thousand characters', () => {
    const folded = foldPage(pageOf([viewOf('error("x" * 5000)')]), stillClock());

    expect(folded.views[0]?.stall?.message).toBe(`${'x'.repeat(1000)}…`);
  });

  it('marks the event whose fold ran past its deadline, so it can be tried again, and folds nothing more', () => {
    const folded = foldPage(
      pageOf([viewOf('reduce range(100000) as $i (0; . + $i)', { view: 0 }), viewOf('. + 1', { view: 0 })], {
        foldDeadlineMs: 10,
        pageBudgetMs: 1_000_000,
      }),
      slowFirstFold(20),
    );

    expect(folded.views[0]).toMatchObject({ view: 0, folded: 0, overtime: 0 });
    expect(folded.views[0]).not.toHaveProperty('stall');
    expect(folded.views[1]).toMatchObject({ view: 3, folded: 3 });
  });

  it('refuses $input, which a fold is never given, and binds $event alone', () => {
    const folded = foldPage(pageOf([viewOf('$input')]), stillClock());

    expect(folded.views[0]?.stall).toMatchObject({
      kind: 'refused',
      message: unboundInput,
    });
  });
});
