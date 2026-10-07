import { execFile } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { PoolOutcome, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { counting, countingElsewhere } from '../testing/counting-workers.ts';
import { liftedLimits, programPool } from './program-pool.ts';

interface Ran {
  readonly jobs: number;
  readonly thread: number;
}

const poolTestTimeoutMs = 30_000;

const pools: ProgramPool[] = [];

const coverage = process.env['NODE_V8_COVERAGE'];

const measured = coverage === undefined ? {} : { NODE_V8_COVERAGE: coverage };

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }));

function executed(script: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(
    process.execPath,
    ['--eval', script],
    { timeout: 20_000 },
    (error: Readonly<Error> | null, stdout: string) => {
      if (error === null) {
        resolve(stdout);
      } else {
        reject(error);
      }
    },
  );
  return promise;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ workers: 4, heapMegabytes: 64, environment: measured, ...settings });
  pools.push(pool);
  return pool;
}

function run(
  pool: ProgramPool,
  source: string,
  worker: Readonly<URL> = counting,
  deadlineMs = 10_000,
): Promise<PoolOutcome> {
  const limits = liftedLimits(64_000_000);
  return pool.run({ source, input: null, dialect: { refused: [] }, limits, deadlineMs, mostOutputBytes: 1000, worker });
}

function ranOf(outcome: PoolOutcome): Ran {
  return decodeRan(outcome.ran === 'answered' ? outcome.output : {});
}

async function counted(pool: ProgramPool, worker: Readonly<URL> = counting): Promise<Ran> {
  return ranOf(await run(pool, 'count', worker));
}

async function held(pool: ProgramPool, jobs: number): Promise<readonly number[]> {
  const outcomes = await Promise.all(Array.from({ length: jobs }, () => run(pool, 'hold')));
  return outcomes.map((outcome) => ranOf(outcome).thread);
}

function threadsAlive(): number {
  const workers: unknown = Reflect.get(process.report.getReport(), 'workers');
  return Array.isArray(workers) ? workers.length : 0;
}

describe('the workers of a pool and its permits', { timeout: poolTestTimeoutMs }, () => {
  it('starts the worker of another module only once it has let go of the oldest idle one, so the threads alive never exceed the permits', async () => {
    const before = threadsAlive();
    const pool = poolOf();

    const four = await held(pool, 4);
    const fullOfIdle = threadsAlive() - before;
    const elsewhere = await counted(pool, countingElsewhere);
    const afterTheOther = threadsAlive() - before;
    const holding = held(pool, 4);
    await setTimeout(150);
    const whileHolding = threadsAlive() - before;
    const again = await holding;

    expect(new Set(four).size).toBe(4);
    expect([fullOfIdle, afterTheOther]).toEqual([4, 4]);
    expect(whileHolding).toBeLessThanOrEqual(4);
    expect(four).not.toContain(elsewhere.thread);
    expect(again.filter((thread) => four.includes(thread))).toHaveLength(3);
  });

  it('starts two jobs of another module at once on a pool full of idle workers once each has let go of one', async () => {
    const before = threadsAlive();
    const pool = poolOf({ workers: 2 });
    await held(pool, 2);

    const both = await Promise.all([counted(pool, countingElsewhere), counted(pool, countingElsewhere)]);

    expect(both.map(({ jobs }) => jobs)).toEqual([1, 1]);
    expect(threadsAlive() - before).toBe(2);
  });
});

describe('the workers of a pool and its permits, while a worker is let go of', { timeout: poolTestTimeoutMs }, () => {
  it('starts two jobs at once against a worker still dying only once it has gone, so the threads alive never exceed the permits', async () => {
    const before = threadsAlive();
    const pool = poolOf({ workers: 2 });
    await Promise.all([run(pool, 'count'), run(pool, 'linger')]);

    const both = Promise.all([run(pool, 'hold', countingElsewhere), run(pool, 'hold', countingElsewhere)]);
    await setTimeout(100);
    const whileTheLastDies = threadsAlive() - before;
    const answered = await both;

    expect(whileTheLastDies).toBeLessThanOrEqual(2);
    expect(answered.map((outcome) => ranOf(outcome).jobs)).toEqual([1, 1]);
  });

  it('ends as closing the jobs that wait for a worker to be let go of when the pool closes', async () => {
    const pool = poolOf({ workers: 2 });
    await held(pool, 2);

    const waiting = [run(pool, 'count', countingElsewhere), run(pool, 'count', countingElsewhere)];
    await pool.close();

    expect(await Promise.all(waiting)).toMatchObject([
      { ran: 'stopped', because: 'closing' },
      { ran: 'stopped', because: 'closing' },
    ]);
  });
});

describe('the deadline of a warm worker', { timeout: poolTestTimeoutMs }, () => {
  it('terminates a warm worker blocked past its deadline while another worker answers, and the jobs after it go to the worker left and a fresh one', async () => {
    const pool = poolOf({ workers: 2 });
    const warm = await counted(pool);
    const settled = { blocked: false };

    const blocked = run(pool, 'block', counting, 1500).then((outcome) => {
      settled.blocked = true;
      return outcome;
    });
    const meanwhile = await counted(pool);
    const answeredFirst = !settled.blocked;
    const ended = await blocked;
    const after = await Promise.all([counted(pool), counted(pool)]);

    expect([answeredFirst, meanwhile.jobs]).toEqual([true, 1]);
    expect(meanwhile.thread).not.toBe(warm.thread);
    expect(ended).toMatchObject({ ran: 'stopped', because: 'deadline' });
    expect(after.map(({ thread }) => thread)).not.toContain(warm.thread);
    expect(after.map(({ jobs }) => jobs).toSorted((first, second) => first - second)).toEqual([1, 2]);
  });
});

describe('a pool that closes', { timeout: poolTestTimeoutMs }, () => {
  it('ends its idle workers, and its busy jobs as closing, leaving no thread alive', async () => {
    const before = threadsAlive();
    const pool = poolOf();
    await counted(pool);

    const blocked = run(pool, 'block');
    await counted(pool);
    await pool.close();

    expect(await blocked).toMatchObject({ ran: 'stopped', because: 'closing' });
    expect(threadsAlive() - before).toBe(0);
  });

  it.each([
    ['once it is closed', 'await pool.close();'],
    ['while its workers are idle', ''],
  ])('holds no process open %s', async (_when, closing) => {
    const script = [
      `const { liftedLimits, programPool } = await import('${new URL('program-pool.ts', import.meta.url).href}');`,
      'const pool = programPool({ workers: 2, heapMegabytes: 64 });',
      "const outcome = await pool.run({ source: '. + 1', input: 1, dialect: { refused: [] }, limits: liftedLimits(1000000), deadlineMs: 10000, mostOutputBytes: 100 });",
      closing,
      'process.stdout.write(JSON.stringify(outcome));',
    ].join('\n');

    const stdout = await executed(script);

    expect(JSON.parse(stdout)).toMatchObject({ ran: 'answered', output: 2 });
  });
});
