import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fakeProcesses, type FakeProcesses } from '../process-testing/fake-processes.ts';
import { memoryLimiter } from './memory-limit.ts';
import { processPool, type ProcessPool, type ProcessPoolSettings } from './process-pool.ts';

const poolTestTimeoutMs = 30_000;

const memoryBytes = 536_870_912;

const theBoundOfItsData: unknown = expect.stringMatching(
  new RegExp(`^Max data size\\s+${memoryBytes}\\s+${memoryBytes}\\s+bytes`, 'u'),
);

const pools: ProcessPool[] = [];

const fakes: FakeProcesses[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
  for (const fake of fakes.splice(0)) {
    fake.remove();
  }
});

function aFake(): FakeProcesses {
  const fake = fakeProcesses();
  fakes.push(fake);
  return fake;
}

function poolOf(settings: Partial<ProcessPoolSettings>): ProcessPool {
  const pool = processPool({ processes: 2, longJobs: 1, memoryBytes, ...settings });
  pools.push(pool);
  return pool;
}

describe('the memory of a process of the pool', { timeout: poolTestTimeoutMs }, () => {
  it('is bounded by prlimit, given the bound of its data, where prlimit is on the path', async () => {
    const fake = aFake();
    const pool = poolOf({ path: fake.limiting });

    const outcome = await pool.run({ module: fake.module, key: 'a', kind: 'echo', payload: 1, deadlineMs: 10_000 });

    expect([pool.limiter, fake.limitedWith(), outcome.ended]).toEqual([
      join(fake.limiting, memoryLimiter),
      `--data=${memoryBytes}`,
      'answered',
    ]);
  });

  it('is not bounded where prlimit is not on the path, and the process starts all the same', async () => {
    const fake = aFake();
    const pool = poolOf({ path: fake.bare });

    const outcome = await pool.run({ module: fake.module, key: 'a', kind: 'echo', payload: 1, deadlineMs: 10_000 });

    expect([pool.limiter, fake.limitedWith(), outcome.ended]).toEqual([undefined, undefined, 'answered']);
  });
});

describe('the memory of a process of the pool on Linux', { timeout: poolTestTimeoutMs }, () => {
  it.skipIf(process.platform !== 'linux')(
    'reaches the bound on Linux, where the job of a process that allocates without end ends out of memory, and the next starts afresh',
    async () => {
      const fake = aFake();
      const pool = poolOf({});

      const limits = await pool.run({
        module: fake.module,
        key: 'a',
        kind: 'limits',
        payload: null,
        deadlineMs: 10_000,
      });
      const allocated = await pool.run({
        module: fake.module,
        key: 'a',
        kind: 'allocate',
        payload: null,
        deadlineMs: 20_000,
      });
      const after = await pool.run({ module: fake.module, key: 'a', kind: 'echo', payload: 1, deadlineMs: 10_000 });

      expect(pool.limiter).toBeDefined();
      expect(limits).toMatchObject({ ended: 'answered', answer: theBoundOfItsData });
      expect([allocated.ended, after.ended]).toEqual(['out_of_memory', 'answered']);
    },
  );
});
