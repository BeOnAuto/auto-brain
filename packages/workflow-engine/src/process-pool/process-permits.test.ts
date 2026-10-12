import { execFile } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

import { Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { fakeProcesses, isAlive } from '../process-testing/fake-processes.ts';
import {
  processPool,
  type ProcessOutcome,
  type ProcessPool,
  type ProcessPoolSettings,
  type ProcessRequest,
} from './process-pool.ts';

interface Ran {
  readonly jobs: number;
  readonly pid: number;
}

const poolTestTimeoutMs = 30_000;

const timerSlackMs = 2;

const fake = fakeProcesses();

const pools: ProcessPool[] = [];

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, pid: Schema.Number }));

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

afterAll(() => {
  fake.remove();
});

function poolOf(settings: Partial<ProcessPoolSettings> = {}): ProcessPool {
  const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 1_073_741_824, path: fake.bare, ...settings });
  pools.push(pool);
  return pool;
}

function run(pool: ProcessPool, kind: string, more: Partial<ProcessRequest> = {}): Promise<ProcessOutcome> {
  return pool.run({ module: fake.module, key: 'a model', kind, payload: 1000, deadlineMs: 10_000, ...more });
}

function ranOf(outcome: ProcessOutcome): Ran {
  return decodeRan(outcome.ended === 'answered' ? outcome.answer : {});
}

async function echoed(pool: ProcessPool, key: string): Promise<Ran> {
  return ranOf(await run(pool, 'echo', { key }));
}

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

describe('the processes of a pool and its permits', { timeout: poolTestTimeoutMs }, () => {
  it('runs at most as many jobs at once as it has permits, and a job that finds none within its deadline is busy', async () => {
    const pool = poolOf();
    const holding = [run(pool, 'sleep', { key: 'a' }), run(pool, 'sleep', { key: 'b' })];

    const third = await run(pool, 'echo', { key: 'c', deadlineMs: 300 });
    const held = await Promise.all(holding);

    expect(third).toMatchObject({ ended: 'busy' });
    expect(third.milliseconds).toBeGreaterThanOrEqual(300 - timerSlackMs);
    expect(held.map(({ ended }) => ended)).toEqual(['answered', 'answered']);
  });

  it('lets go of the oldest idle process before it starts one for another key, so the processes alive never exceed its permits', async () => {
    const pool = poolOf();
    const first = await echoed(pool, 'a');
    const second = await echoed(pool, 'b');

    const third = await echoed(pool, 'c');

    expect([isAlive(first.pid), isAlive(second.pid), isAlive(third.pid)]).toEqual([false, true, true]);
  });

  it('holds back for long jobs no more permits than its share, so a short job always finds one', async () => {
    const pool = poolOf({ processes: 3, longJobs: 2 });
    const settled = { long: false };
    const long = Promise.all([
      run(pool, 'sleep', { key: 'a', long: true, payload: 5000 }),
      run(pool, 'sleep', { key: 'b', long: true, payload: 5000 }),
    ]).then((outcomes: readonly ProcessOutcome[]) => {
      settled.long = true;
      return outcomes;
    });

    const thirdLong = await run(pool, 'echo', { key: 'c', long: true, deadlineMs: 300 });
    const short = await run(pool, 'echo', { key: 'd', deadlineMs: 4000 });
    const whileTheLongRan = !settled.long;
    await long;

    expect([thirdLong.ended, short.ended, whileTheLongRan]).toEqual(['busy', 'answered', true]);
  });
});

describe('the deadline of a job of a process', { timeout: poolTestTimeoutMs }, () => {
  it('kills a warm process blocked past it, while a process of another key answers and the pool goes on, and the next job of its key starts afresh', async () => {
    const pool = poolOf();
    const warm = await echoed(pool, 'a');
    const other = await echoed(pool, 'b');
    const started = performance.now();
    const settled = { run: false };

    const blocked = run(pool, 'block', { key: 'a', deadlineMs: 1000 }).then((outcome) => {
      settled.run = true;
      return outcome;
    });
    const ticked = await setTimeout(100, performance.now() - started);
    const elsewhere = await echoed(pool, 'b');
    const answeredFirst = !settled.run;
    const outcome = await blocked;
    const after = await echoed(pool, 'a');

    expect(outcome).toMatchObject({ ended: 'timed_out' });
    expect(outcome.milliseconds).toBeGreaterThanOrEqual(1000 - timerSlackMs);
    expect([ticked < 1000, answeredFirst, elsewhere.pid === other.pid]).toEqual([true, true, true]);
    expect([after.jobs, after.pid === warm.pid, isAlive(warm.pid)]).toEqual([1, false, false]);
  });
});

describe('a pool of processes that closes', { timeout: poolTestTimeoutMs }, () => {
  it('ends its idle processes and its busy ones, a busy job as closing, and runs no job after', async () => {
    const pool = poolOf();
    const idle = await echoed(pool, 'a');
    const busy = run(pool, 'sleep', { key: 'b', payload: 5000 });
    await setTimeout(200);

    await pool.close();
    const after = await run(pool, 'echo', { key: 'a' });

    expect([(await busy).ended, after.ended, isAlive(idle.pid)]).toEqual(['closing', 'closing', false]);
  });

  it('ends as closing a job that waits for a permit', async () => {
    const pool = poolOf({ processes: 1 });
    const busy = run(pool, 'sleep', { key: 'a', payload: 5000 });
    const waiting = run(pool, 'echo', { key: 'b' });
    await setTimeout(200);

    await pool.close();

    expect((await Promise.all([busy, waiting])).map(({ ended }) => ended)).toEqual(['closing', 'closing']);
  });

  it.each([
    ['once it is closed', 'await pool.close();'],
    ['while its processes are idle', ''],
  ])('holds the server open no longer %s', async (_when, closing) => {
    const script = [
      `const { processPool } = await import('${new URL('process-pool.ts', import.meta.url).href}');`,
      `const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 1073741824, path: ${JSON.stringify(fake.bare)} });`,
      `const outcome = await pool.run({ module: new URL('${fake.module.href}'), key: 'a', kind: 'echo', payload: 1, deadlineMs: 10000 });`,
      closing,
      'process.stdout.write(JSON.stringify(outcome.ended));',
    ].join('\n');

    expect(await executed(script)).toBe('"answered"');
  });
});
