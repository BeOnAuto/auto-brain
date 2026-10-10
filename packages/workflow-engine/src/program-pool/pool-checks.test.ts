import { setTimeout } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import type { CheckOutcome, CheckRequest, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { brokenAtStart, checking, checkingForever, checkingReadyAfter } from '../pool-testing/checking-workers.ts';
import { counting } from '../pool-testing/counting-workers.ts';
import { unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { checkPermits, mostCheckStartMs, programPool } from './program-pool.ts';

const poolTestTimeoutMs = 30_000;

const longerThanTheTestMs = 2 * poolTestTimeoutMs;

const slowStartMs = 2000;

const pools: ProgramPool[] = [];

const coverage = process.env['NODE_V8_COVERAGE'];

const measured = coverage === undefined ? {} : { NODE_V8_COVERAGE: coverage };

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ workers: 4, heapMegabytes: 64, environment: measured, ...settings });
  pools.push(pool);
  return pool;
}

function checkOf(more: Partial<CheckRequest> = {}): CheckRequest {
  return {
    schemas: {},
    expressions: [{ source: '$data.a', names: ['$data'] }],
    deadlineMs: 2000,
    worker: checking,
    ...more,
  };
}

function threadOf(outcome: CheckOutcome): number | undefined {
  return outcome.ran === 'checked' ? outcome.issues[0]?.line : undefined;
}

function blocked(pool: ProgramPool) {
  return pool.run({
    source: 'block',
    entry: 'default',
    arguments: [null],
    moment: 0,
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    deadlineMs: longerThanTheTestMs,
    mostOutputBytes: 1000,
    worker: counting,
  });
}

describe('the permit of the checks of a pool', { timeout: poolTestTimeoutMs }, () => {
  it('runs on a permit of its own, so it never waits behind the runs that take every worker', async () => {
    const pool = poolOf({ workers: 2 });
    const runs = [blocked(pool), blocked(pool)];

    const checked = await pool.check(checkOf());

    expect(checkPermits).toBe(1);
    expect(checked).toMatchObject({ ran: 'checked', issues: [{ at: 0, detail: '$data.a' }] });
    await pool.close();
    expect(await Promise.all(runs)).toMatchObject([
      { ran: 'stopped', because: 'closing' },
      { ran: 'stopped', because: 'closing' },
    ]);
  });

  it('waits for its one permit until its deadline, and stops a check that runs past it', async () => {
    const pool = poolOf();
    const first = pool.check(checkOf({ worker: checkingForever, deadlineMs: 2000 }));

    const second = await pool.check(checkOf({ deadlineMs: 300 }));

    expect(second).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(await first).toMatchObject({ ran: 'stopped', because: 'deadline' });
  });

  it('takes no more checks once the pool is closed', async () => {
    const pool = poolOf();
    await pool.close();

    expect(await pool.check(checkOf())).toMatchObject({ ran: 'stopped', because: 'closing' });
  });
});

describe('the worker of the checks of a pool, while it starts', { timeout: poolTestTimeoutMs }, () => {
  it('counts a check’s deadline from when its worker is ready, so a worker slower to start than the deadline answers', async () => {
    const pool = poolOf();

    const checked = await pool.check(checkOf({ worker: checkingReadyAfter(slowStartMs), deadlineMs: 300 }));

    expect(checked).toMatchObject({ ran: 'checked' });
    expect(checked.milliseconds).toBeGreaterThan(slowStartMs);
    expect(mostCheckStartMs).toBe(10_000);
  });

  it('ends a check busy when its worker is not ready within the start a check allows, and never ends the worker while it starts', async () => {
    const pool = poolOf({ checkStartMs: 200 });
    const worker = checkingReadyAfter(slowStartMs);

    const early = await pool.check(checkOf({ worker }));
    const cancelling = new AbortController();
    const cancelled = pool.check(checkOf({ worker }), cancelling.signal);
    await setTimeout(100);
    cancelling.abort();
    await setTimeout(2 * slowStartMs);
    const [first, second] = [await pool.check(checkOf({ worker })), await pool.check(checkOf({ worker }))];

    expect(early).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(await cancelled).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect([first.ran, threadOf(second)]).toEqual(['checked', threadOf(first)]);
  });

  it('ends a check closing when the pool closes while its worker starts, and crashed when the worker ends before it is ready', async () => {
    const pool = poolOf();
    const starting = pool.check(checkOf({ worker: checkingReadyAfter(slowStartMs) }));
    await setTimeout(100);

    await pool.close();

    expect(await starting).toMatchObject({ ran: 'stopped', because: 'closing' });
    expect(await poolOf().check(checkOf({ worker: brokenAtStart }))).toMatchObject({
      ran: 'crashed',
      detail: 'The worker ended before it was ready',
    });
  });
});

describe('the worker of the checks of a pool, once it started', { timeout: poolTestTimeoutMs }, () => {
  it('is kept however long it idles, so a save never waits for its start again', async () => {
    const pool = poolOf({ idleMs: 100 });

    const first = await pool.check(checkOf());
    await setTimeout(500);
    const later = await pool.check(checkOf());

    expect(threadOf(later)).toBe(threadOf(first));
  });
});
