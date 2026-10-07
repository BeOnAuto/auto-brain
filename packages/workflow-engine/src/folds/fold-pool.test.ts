import { afterEach, describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import type { FoldRequest, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { liftedLimits, programPool } from '../program-pool/program-pool.ts';
import type { FoldingView } from './fold-page.ts';

const poolTestTimeoutMs = 30_000;

const timerSlackMs = 2;

const pools: ProgramPool[] = [];

const noSchemaChecked: unknown = expect.stringContaining('checks no view schema');

const noted = { type: 'noted' };

const events: readonly JsonObject[] = [
  { ...noted, data: { n: 1 } },
  { ...noted, data: { n: 2 } },
];

function workerOf(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function markingThen(event: number, view: number, then: string): URL {
  return workerOf(
    `import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ progress }) => { const place = new Int32Array(progress); Atomics.store(place, 0, ${event}); Atomics.store(place, 1, ${view}); ${then} });`,
  );
}

const markingThenBlocking = markingThen(1, 0, 'while (true) {}');

const coverage = process.env['NODE_V8_COVERAGE'];

const measured = coverage === undefined ? {} : { NODE_V8_COVERAGE: coverage };

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ workers: 4, heapMegabytes: 64, environment: measured, ...settings });
  pools.push(pool);
  return pool;
}

function viewOf(fold: string, more: Partial<FoldingView> = {}): FoldingView {
  return { fold, filters: [noted], view: 0, events: [0, 1], ...more };
}

function request(views: readonly FoldingView[], more: Partial<FoldRequest> = {}): FoldRequest {
  return {
    events,
    views,
    dialect: { refused: [], variables: ['event'] },
    variable: 'event',
    limits: liftedLimits(16_000_000),
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    waitMs: 10_000,
    deadlineMs: 13_000,
    ...more,
  };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe('a page of folds in a worker of the pool', { timeout: poolTestTimeoutMs }, () => {
  it('answers each view after the page, what it folded and the work it did', async () => {
    const outcome = await poolOf().fold(
      request([viewOf('. + $event.data.n'), viewOf('[.] + [$event.data.n]', { view: [], events: [1] })]),
    );

    expect(outcome).toMatchObject({
      ran: 'folded',
      early: false,
      views: [
        { view: 3, folded: 2, lastFolded: 1, through: 1 },
        { view: [[], 2], folded: 1, lastFolded: 1, through: 1 },
      ],
    });
    expect(outcome.milliseconds).toBeGreaterThan(0);
  });

  it("stalls a view that keeps a schema, which the engine's own worker checks none of", async () => {
    expect(await poolOf().fold(request([viewOf('. + 1', { schema: { type: 'integer' } })]))).toMatchObject({
      views: [{ stall: { at: 0, kind: 'schema', message: noSchemaChecked } }],
    });
  });

  it('stalls a fold at the fixed depth of evaluation on the stack of every worker', async () => {
    const recursion = 'def g: if . == 0 then 0 else (. - 1 | g) end; 3000 | g';

    expect(await poolOf().fold(request([viewOf(recursion)]))).toMatchObject({
      views: [{ stall: { at: 0, kind: 'depth', message: 'Max depth exceeded' } }],
    });
  });
});

describe('a page of folds the pool stops', { timeout: poolTestTimeoutMs }, () => {
  it('names the event and the view whose fold was going when it reached its deadline', async () => {
    const outcome = await poolOf({ foldWorker: markingThenBlocking }).fold(request([viewOf('.')], { deadlineMs: 500 }));

    expect(outcome).toMatchObject({ ran: 'stopped', because: 'deadline', progress: { event: 1, view: 0 } });
    expect(outcome.milliseconds).toBeGreaterThanOrEqual(500 - timerSlackMs);
  });

  it('names the fold that took more memory than its worker has', async () => {
    const markingThenAllocating = markingThen(
      0,
      1,
      'const kept = []; while (true) { kept.push(new Array(100000).fill(kept.length)); }',
    );

    expect(
      await poolOf({ heapMegabytes: 16, foldWorker: markingThenAllocating }).fold(request([viewOf('.')])),
    ).toMatchObject({ ran: 'stopped', because: 'memory', progress: { event: 0, view: 1 } });
  });
});

describe('a page of folds that waits for a worker', { timeout: poolTestTimeoutMs }, () => {
  it('counts its deadline from when a worker takes it, after it waited for one', async () => {
    const pool = poolOf({ workers: 1 });
    const busy = pool.run({
      source: '[range(500000)] | length',
      input: null,
      dialect: { refused: [] },
      limits: liftedLimits(64_000_000),
      deadlineMs: 10_000,
      mostOutputBytes: 100,
    });

    const folded = await pool.fold(request([viewOf('. + 1')], { deadlineMs: 2000 }));

    expect(await busy).toMatchObject({ ran: 'answered' });
    expect(folded).toMatchObject({ ran: 'folded', views: [{ view: 2 }] });
  });

  it('is turned away when no worker comes free within its wait, and names no fold', async () => {
    const pool = poolOf({ workers: 1, foldWorker: markingThenBlocking });
    const blocking = pool.fold(request([viewOf('.')], { deadlineMs: 5000 }));

    const turnedAway = await pool.fold(request([viewOf('.')], { waitMs: 200 }));

    expect(turnedAway).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(turnedAway).not.toHaveProperty('progress');
    await pool.close();
    expect(await blocking).toMatchObject({ ran: 'stopped', because: 'closing' });
  });
});

describe('a page of folds that does not end', { timeout: poolTestTimeoutMs }, () => {
  it('is answered as crashed when its worker answers with something else', async () => {
    const nonsense = workerOf(
      'import { parentPort } from "node:worker_threads"; parentPort.postMessage({ ran: "folded" });',
    );

    expect(await poolOf({ foldWorker: nonsense }).fold(request([viewOf('.')]))).toMatchObject({
      ran: 'crashed',
      detail: 'The worker answered with something that is not an answer',
    });
  });

  it('is stopped when it is cancelled', async () => {
    const cancelling = new AbortController();
    cancelling.abort();

    expect(await poolOf().fold(request([viewOf('.')]), cancelling.signal)).toMatchObject({
      ran: 'stopped',
      because: 'cancelled',
    });
  });
});
