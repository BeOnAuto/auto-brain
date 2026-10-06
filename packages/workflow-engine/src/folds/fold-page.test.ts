import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { liftedLimits } from '../program-pool/program-pool.ts';
import { foldPage, type FoldHost, type FoldPage, type FoldingView, type ViewCheck } from './fold-page.ts';

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

const springApproved = succeeded('spring', 'approve', '2026-10-01T09:00:00Z');

const events: readonly JsonObject[] = [
  springApproved,
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

function entriesAtMost(schema: JsonObject): ViewCheck {
  const most = Number(schema['maxProperties']);
  return (view) =>
    typeof view === 'object' && view !== null && Object.keys(view).length > most
      ? `the view: Expected a value with at most ${most} entry`
      : undefined;
}

function stillClock(): FoldHost & { readonly marks: readonly string[] } {
  const marks: string[] = [];
  return {
    marks,
    now: () => 0,
    folding: (event, view) => {
      marks.push(`${event}:${view}`);
    },
    checkOf: entriesAtMost,
  };
}

function slowFirstFold(stepMs: number): FoldHost {
  const time = { now: 0, slow: false };
  return {
    now: () => {
      time.now += time.slow ? stepMs : 0;
      return time.now;
    },
    folding: (event, view) => {
      time.slow = event === 0 && view === 0;
    },
    checkOf: entriesAtMost,
  };
}

function foldsTaking(stepMs: number): FoldHost & { readonly marks: readonly string[] } {
  const time = { now: 0 };
  const marks: string[] = [];
  return {
    marks,
    now: () => time.now,
    folding: (event, view) => {
      marks.push(`${event}:${view}`);
      time.now += stepMs;
    },
    checkOf: entriesAtMost,
  };
}

function runningClock(stepMs: number): FoldHost {
  const time = { now: 0 };
  return {
    now: () => {
      time.now += stepMs;
      return time.now;
    },
    folding: Function.constVoid,
    checkOf: entriesAtMost,
  };
}

describe('a page of folds', () => {
  it('folds each event a view considers and its filters match, in order, with the event bound as $event', () => {
    const clock = stillClock();

    const folded = foldPage(pageOf([viewOf(byCampaign), viewOf('. + 1', { view: 0, events: [2, 3] })]), clock);

    expect(folded).toMatchObject({
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
          through: 3,
        },
        { view: 2, folded: 2, lastFolded: 3, through: 3 },
      ],
    });
    expect(clock.marks).toEqual(['0:0', '1:0', '2:0', '2:1', '3:0', '3:1']);
  });
});

describe('the events a page of folds folds', () => {
  it('keeps a view as it was when no event of the page is one it considers', () => {
    expect(foldPage(pageOf([viewOf(byCampaign, { events: [] })]), stillClock()).views[0]).toEqual({
      view: {},
      folded: 0,
      lastFolded: -1,
      through: 3,
      work: 0,
    });
    expect(foldPage(pageOf([], { events: [] }), stillClock())).toEqual({ early: false, views: [] });
  });

  it('ends early once its budget of time is spent, before the next fold, each view answering how far it went', () => {
    const folded = foldPage(pageOf([viewOf('. + 1', { view: 0 })], { pageBudgetMs: 5 }), runningClock(3));

    expect(folded).toMatchObject({ early: true, views: [{ view: 1, folded: 1, lastFolded: 0, through: 0 }] });
  });

  it('checks its budget before every fold, so a neighbour of a slow fold is never folded past the budget', () => {
    const slowFolds = foldsTaking(2100);
    const views = Array.from({ length: 4 }, () => viewOf('. + 1', { view: 0, events: [0] }));

    const folded = foldPage(pageOf(views, { events: [springApproved], foldDeadlineMs: 5000 }), slowFolds);

    expect(folded).toMatchObject({
      early: true,
      views: [
        { folded: 1, through: 0 },
        { folded: 0, through: -1 },
        { folded: 0, through: -1 },
        { folded: 0, through: -1 },
      ],
    });
    expect(slowFolds.marks).toEqual(['0:0']);
    expect(folded.views.some(({ overtime }) => overtime !== undefined)).toBe(false);
  });

  it('runs at least one fold a page, however small its budget', () => {
    const folded = foldPage(pageOf([viewOf('. + 1', { view: 0 })], { pageBudgetMs: 0 }), runningClock(3));

    expect(folded).toMatchObject({ early: true, views: [{ folded: 1, through: 0 }] });
  });
});

const refusedArgs: unknown = expect.stringContaining('$ARGS reads arguments');

const unboundInput: unknown = expect.stringContaining('$input is not defined');

const filterUnbound: unknown = expect.stringContaining('A filter does not compile on this server: $x is not defined');

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
      { kind: 'size', message: 'The view takes more than the 524288 bytes as JSON a view may' },
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

  it('cuts the message of a stall at 1,024 bytes', () => {
    const folded = foldPage(pageOf([viewOf('error("x" * 5000)')]), stillClock());

    expect(folded.views[0]?.stall?.message).toBe(`${'x'.repeat(1024)}…`);
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

describe('the filters of a view in a page of folds', () => {
  it('run under the deadline and the limits of its fold, after the fold that was going is marked', () => {
    const slowFilter = [{ type: 'execution_succeeded', data: '${ reduce range(100000) as $i (0; . + $i) > 0 }' }];
    const greedyFilter = [{ type: 'execution_succeeded', data: '${ ("x" * 20000000 | length) > 0 }' }];
    const views = [
      viewOf('. + 1', { view: 0, filters: slowFilter }),
      viewOf('. + 1', { view: 0, filters: greedyFilter }),
      viewOf('. + 1', { view: 0 }),
    ];

    const folded = foldPage(pageOf(views, { foldDeadlineMs: 10, pageBudgetMs: 1_000_000 }), slowFirstFold(20));

    expect(folded.views[0]).toMatchObject({ view: 0, folded: 0, overtime: 0 });
    expect(folded.views[1]).toMatchObject({ view: 0, folded: 0, stall: { at: 0, kind: 'work' } });
    expect(folded.views[2]).toMatchObject({ view: 3, folded: 3 });
  });

  it('stall a view whose filter does not compile on this server', () => {
    const filters = [{ type: 'execution_succeeded', data: '${ $x }' }];

    expect(foldPage(pageOf([viewOf('. + 1', { view: 0, filters })]), stillClock()).views[0]).toMatchObject({
      folded: 0,
      stall: { at: 0, kind: 'refused', message: filterUnbound },
    });
  });
});
