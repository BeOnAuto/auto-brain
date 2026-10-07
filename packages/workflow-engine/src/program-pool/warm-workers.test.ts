import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { FoldingView } from '../folds/fold-page.ts';
import type { FoldOutcome, FoldRequest, PoolOutcome, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { counting, countingElsewhere, countingOnTheLoop } from '../testing/counting-workers.ts';
import { liftedLimits, programPool } from './program-pool.ts';

interface Ran {
  readonly jobs: number;
  readonly thread: number;
}

interface Running {
  readonly deadlineMs?: number;
  readonly signal?: Readonly<AbortSignal>;
  readonly worker?: Readonly<URL>;
}

const poolTestTimeoutMs = 30_000;

const pools: ProgramPool[] = [];

const coverage = process.env['NODE_V8_COVERAGE'];

const measured = coverage === undefined ? {} : { NODE_V8_COVERAGE: coverage };

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }));

const noted = { type: 'noted' };

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ workers: 4, heapMegabytes: 64, environment: measured, ...settings });
  pools.push(pool);
  return pool;
}

function run(pool: ProgramPool, source: string, running: Running = {}): Promise<PoolOutcome> {
  const { deadlineMs = 10_000, signal, worker = counting } = running;
  const limits = liftedLimits(64_000_000);
  return pool.run(
    { source, input: null, dialect: { refused: [] }, limits, deadlineMs, mostOutputBytes: 1_048_576, worker },
    signal,
  );
}

function ranOf(outcome: PoolOutcome): Ran {
  return decodeRan(outcome.ran === 'answered' ? outcome.output : {});
}

async function counted(pool: ProgramPool, worker: Readonly<URL> = counting): Promise<Ran> {
  return ranOf(await run(pool, 'count', { worker }));
}

function foldOf(
  pool: ProgramPool,
  views: readonly Partial<FoldingView>[],
  more: Partial<FoldRequest> = {},
): Promise<FoldOutcome> {
  return pool.fold({
    events: [
      { ...noted, data: { n: 1 } },
      { ...noted, data: { n: 2 } },
    ],
    views: views.map((view) => ({ fold: '. + $event.data.n', filters: [noted], view: 0, events: [0, 1], ...view })),
    dialect: { refused: [], variables: ['event'] },
    variable: 'event',
    limits: liftedLimits(16_000_000),
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    waitMs: 10_000,
    deadlineMs: 13_000,
    worker: countingOnTheLoop,
    ...more,
  });
}

describe('a worker of the pool kept between jobs', { timeout: poolTestTimeoutMs }, () => {
  it('takes job after job in one thread, which counts them 1, 2 and 3', async () => {
    const pool = poolOf();

    const ran = [await counted(pool), await counted(pool), await counted(pool)];

    expect(ran.map(({ jobs }) => jobs)).toEqual([1, 2, 3]);
    expect(new Set(ran.map(({ thread }) => thread)).size).toBe(1);
  });

  it('keeps the warm worker a job takes past the time it may idle, so a job longer than that answers in the same thread', async () => {
    const pool = poolOf({ idleMs: 100 });
    const first = await counted(pool);

    const held = await run(pool, 'hold');

    expect(ranOf(held)).toEqual({ jobs: 2, thread: first.thread });
  });

  it('is recycled after the last of the jobs a worker takes', async () => {
    const pool = poolOf({ jobsPerWorker: 2 });

    const ran = [await counted(pool), await counted(pool), await counted(pool)];

    expect(ran.map(({ jobs }) => jobs)).toEqual([1, 2, 1]);
  });

  it('is let go of once it has been idle for the time a worker may idle', async () => {
    const pool = poolOf({ idleMs: 100 });
    const first = await counted(pool);

    await setTimeout(500);
    const next = await counted(pool);

    expect([first.jobs, next.jobs]).toEqual([1, 1]);
    expect(next.thread).not.toBe(first.thread);
  });
});

describe('a worker of the pool after a job the pool had to stop', { timeout: poolTestTimeoutMs }, () => {
  it.each<readonly [string, string, Partial<PoolSettings>, Readonly<Record<string, unknown>>]>([
    ['its deadline stopped', 'block', {}, { ran: 'stopped', because: 'deadline' }],
    ['ran out of memory', 'allocate', { heapMegabytes: 16 }, { ran: 'stopped', because: 'memory' }],
    ['crashed', 'crash', {}, { ran: 'crashed', detail: 'The worker failed: broken on purpose' }],
    ['answered a job it was not given', 'wrong job', {}, { ran: 'crashed' }],
    ['answered that it may not be kept', 'let go', {}, { ran: 'answered' }],
  ])(
    'is let go of after a job it %s, so the next job starts in a fresh worker',
    async (_why, source, settings, ended) => {
      const pool = poolOf(settings);
      const first = await counted(pool);

      const outcome = await run(pool, source, { deadlineMs: 2000 });
      const next = await counted(pool);

      expect(outcome).toMatchObject(ended);
      expect([first.jobs, next.jobs]).toEqual([1, 1]);
      expect(next.thread).not.toBe(first.thread);
    },
  );

  it('is let go of after a job its caller cancelled', async () => {
    const pool = poolOf();
    const first = await counted(pool);
    const cancelling = new AbortController();

    const blocked = run(pool, 'block', { signal: cancelling.signal });
    await setTimeout(100);
    cancelling.abort();

    expect(await blocked).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect([first.jobs, (await counted(pool)).jobs]).toEqual([1, 1]);
  });
});

describe('a job of the pool cancelled before it has a worker', { timeout: poolTestTimeoutMs }, () => {
  it('ends as cancelled a job cancelled while it waits for its seat, rather than running it to its deadline', async () => {
    const pool = poolOf({ workers: 1 });
    await counted(pool);
    const cancelling = new AbortController();

    const blocked = run(pool, 'block', { deadlineMs: 3000, signal: cancelling.signal, worker: countingElsewhere });
    setImmediate(() => {
      cancelling.abort();
    });
    const ended = await blocked;

    expect(ended).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect(ended.milliseconds).toBeLessThan(2000);
    expect((await counted(pool)).jobs).toBe(1);
  });
});

describe('a worker of the pool after a job whose answer says not to keep it', { timeout: poolTestTimeoutMs }, () => {
  it('is let go of after a program its evaluator ended at the deadline', async () => {
    const pool = poolOf();

    const ran = [
      await counted(pool, countingOnTheLoop),
      await run(pool, 'early:reduce range(100000000) as $i (0; . + 1)', { worker: countingOnTheLoop }),
      await counted(pool, countingOnTheLoop),
    ];

    expect(ran).toMatchObject([{ jobs: 1 }, { ran: 'exhausted', limit: 'deadline' }, { jobs: 1 }]);
  });

  it.each<readonly [string, Partial<FoldRequest>, Readonly<Record<string, unknown>>]>([
    ['a view ran past its deadline', { foldDeadlineMs: 1 }, { ran: 'folded', views: [{ overtime: 0 }] }],
    ['it could not read', { variable: 'unreadable' }, { ran: 'unreadable' }],
  ])('is let go of after a page %s', async (_why, more, ended) => {
    const pool = poolOf();
    const slow = { fold: 'reduce range(1000000) as $i (.; . + 1)' };

    const ran = [
      await counted(pool, countingOnTheLoop),
      await foldOf(pool, [slow], more),
      await counted(pool, countingOnTheLoop),
    ];

    expect(ran).toMatchObject([{ jobs: 1 }, ended, { jobs: 1 }]);
  });

  it('keeps its worker after a page that stalled, which then folds the next page as a fresh worker does', async () => {
    const warm = poolOf({ workers: 1 });
    const views = [{}, { fold: '[.] + [$event.data.n]', view: [] }];

    const stalled = await foldOf(warm, [{ fold: 'error("stop \\($event.data.n)")' }]);
    const afterTheStall = await foldOf(warm, views);
    const ran = await counted(warm, countingOnTheLoop);
    const cold = await foldOf(poolOf({ workers: 1 }), views);

    expect(stalled).toMatchObject({ ran: 'folded', views: [{ stall: { kind: 'raised', message: 'stop 1' } }] });
    expect({ ...afterTheStall, milliseconds: 0 }).toEqual({ ...cold, milliseconds: 0 });
    expect(ran.jobs).toBe(3);
  });
});

describe('a worker of the pool that, idle, sends a message, fails or ends', { timeout: poolTestTimeoutMs }, () => {
  it.each(['then message', 'then throw', 'then exit'])(
    'is forgotten, ending no job, and the next job starts afresh (%s)',
    async (misbehaviour) => {
      const pool = poolOf();
      const first = ranOf(await run(pool, misbehaviour));

      await setTimeout(400);
      const next = await counted(pool);

      expect([first.jobs, next.jobs]).toEqual([1, 1]);
      expect(next.thread).not.toBe(first.thread);
    },
  );
});
