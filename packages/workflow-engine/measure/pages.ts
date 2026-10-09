import { Function } from 'effect';

import { liftedLimits, programPool, type FoldRequest, type JsonObject, type ProgramPool } from '../src/dsl.ts';
import { foldPage } from '../src/folds/fold-page.ts';
import { compileProgram } from '../src/programs/program-compiling.ts';
import { millisecondsOf } from './common.ts';

const reviewsFold = [
  '($event.data.output | if type == "object" then .campaign else null end | if type == "string" then . else "unknown" end) as $campaign',
  '| .[$campaign] += [{ at: $event.time, verdict: ($event.data.output.verdict? // "none" | tostring | .[0:200]), run: $event.source }]',
  '| .[$campaign] |= .[-20:]',
  '| to_entries | sort_by(.value[-1].at) | .[-50:] | from_entries',
].join('\n');

const events = 1000;

const turns = 9;

function reviewed(index: number): JsonObject {
  return {
    specversion: '1.0',
    source: `/runs/0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}`,
    type: 'run_succeeded',
    subject: 'reasoning/review-brief',
    time: new Date(Date.UTC(2026, 9, 6) + index * 1000).toISOString(),
    data: {
      type: 'reasoning',
      name: 'review-brief',
      version: 1,
      output: { campaign: `campaign-${index % 100}`, verdict: index % 3 === 0 ? 'reject' : 'approve' },
    },
  };
}

function pageOf(count: number): FoldRequest {
  const page = Array.from({ length: count }, (_, index) => reviewed(index));
  return {
    events: page,
    views:
      count === 0
        ? []
        : [
            {
              fold: reviewsFold,
              filters: [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }],
              view: {},
              events: page.map((_, index) => index),
            },
          ],
    dialect: { refused: [], variables: ['event'] },
    variable: 'event',
    limits: liftedLimits(16_000_000),
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    waitMs: 10_000,
    deadlineMs: 17_000,
  };
}

function passing(): undefined {
  return undefined;
}

function median(samples: readonly number[]): number {
  return samples.toSorted((first, second) => first - second)[Math.floor(samples.length / 2)] ?? 0;
}

function formatted(value: number, digits = 1): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function inTurn<A, B>(items: readonly A[], step: (item: A) => Promise<B>): Promise<readonly B[]> {
  return items.reduce<Promise<readonly B[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}

async function onAFreshPool(page: FoldRequest): Promise<number> {
  const pool = programPool({ workers: 1, heapMegabytes: 256 });
  const { milliseconds } = await pool.fold(page);
  await pool.close();
  return milliseconds;
}

function foldedOnThisThread(page: FoldRequest): { readonly milliseconds: number; readonly views: string } {
  const folded = { views: '' };
  const host = {
    now: () => performance.now(),
    folding: Function.constVoid,
    checkOf: () => passing,
    compile: compileProgram,
  };
  const milliseconds = millisecondsOf(() => {
    folded.views = JSON.stringify(foldPage(page, host).views);
  });
  return { milliseconds, views: folded.views };
}

function roundTripOf(page: FoldRequest, views: string): number {
  return millisecondsOf(() => {
    JSON.parse(JSON.stringify(page.events));
    JSON.parse(JSON.stringify(page.views));
    JSON.parse(views);
  });
}

interface Turn {
  readonly cold: number;
  readonly warm: number;
  readonly folds: number;
}

function turnsOf(page: FoldRequest, pool: ProgramPool): Promise<readonly Turn[]> {
  return inTurn(Array.from({ length: turns }), async () => {
    const cold = await onAFreshPool(page);
    const { milliseconds: warm } = await pool.fold(page);
    const { milliseconds: folds } = foldedOnThisThread(page);
    return { cold, warm, folds };
  });
}

function medianOf(all: readonly Turn[], of: (turn: Turn) => number): string {
  return formatted(median(all.map((turn) => of(turn))));
}

export async function pagesMeasured(): Promise<readonly string[]> {
  const page = pageOf(events);
  const start = await inTurn(Array.from({ length: turns }), () => onAFreshPool(pageOf(0)));
  const pool = programPool({ workers: 1, heapMegabytes: 256 });
  await pool.fold(page);
  const all = await turnsOf(page, pool);
  await pool.close();
  const { views } = foldedOnThisThread(page);
  const bytes = JSON.stringify(page.events).length + JSON.stringify(page.views).length + views.length;
  const roundTrip = median(Array.from({ length: turns }, () => roundTripOf(page, views)));
  return [
    `a fold worker's start, a page with no events on a fresh pool: ${formatted(median(start))} ms at the median of ${start.length}`,
    `a page of the example's ${formatted(events, 0)} events in turn cold, on a fresh pool, warm, and folded on the thread that measures, ${all.length} times: ${medianOf(all, ({ cold }) => cold)} ms, ${medianOf(all, ({ warm }) => warm)} ms and ${medianOf(all, ({ folds }) => folds)} ms at the median`,
    `the cold page less the warm one: ${medianOf(all, ({ cold, warm }) => cold - warm)} ms at the median; the warm page less its folds: ${medianOf(all, ({ warm, folds }) => warm - folds)} ms`,
    `the JSON round trip of its ${formatted(bytes, 0)} bytes in and out, on the thread that measures: ${formatted(roundTrip, 2)} ms at the median of ${turns}`,
  ];
}
