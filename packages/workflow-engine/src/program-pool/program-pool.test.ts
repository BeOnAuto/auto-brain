import { setTimeout } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import { liftedLimits, programPool, type PoolSettings, type ProgramPool, type ProgramRequest } from './program-pool.ts';

const poolTestTimeoutMs = 30_000;

const timerSlackMs = 2;

const dialect: Dialect = { refused: [{ name: 'now', why: 'reads the clock' }], variables: [] };

const pools: ProgramPool[] = [];

function workerOf(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

const blocking = workerOf('while (true) {}');

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ workers: 4, heapMegabytes: 64, ...settings });
  pools.push(pool);
  return pool;
}

function request(source: string, input: Json = null, more: Partial<ProgramRequest> = {}): ProgramRequest {
  return {
    source,
    input,
    dialect,
    limits: liftedLimits(64_000_000),
    deadlineMs: 10_000,
    mostOutputBytes: 1_048_576,
    ...more,
  };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe('a program run in a worker of the pool', { timeout: poolTestTimeoutMs }, () => {
  it('answers its output as JSON with its size and the work it did, and how long the run took', async () => {
    const outcome = await poolOf().run(request('[.rows[] | . * 2]', { rows: [1, 2, 3] }));

    expect(outcome).toMatchObject({ ran: 'answered', output: [2, 4, 6], bytes: 7, work: 1952 });
    expect(outcome.milliseconds).toBeGreaterThan(0);
  });

  it.each<readonly [string, string, Json, Readonly<Record<string, unknown>>]>([
    [
      'raises an error',
      '.a | error("stop")',
      { a: 1 },
      { ran: 'raised', issue: { detail: 'stop', span: { start: 5, end: 18 } } },
    ],
    ['does too much work', '"x" * 100000000', null, { ran: 'exhausted', limit: 'work' }],
    ['nests a value too deep', 'reduce range(600) as $i (null; [.])', null, { ran: 'exhausted', limit: 'value depth' }],
    ['gives no output', 'empty', null, { ran: 'unanswered', outputs: 0 }],
    ['gives two outputs', '1, 2', null, { ran: 'unanswered', outputs: 2 }],
    ['gives a number JSON cannot carry', 'nan', null, { ran: 'unfit' }],
    ['calls what its dialect refuses', 'now', null, { ran: 'refused', issues: [{ detail: 'now reads the clock' }] }],
  ])('answers how it ended when it %s', async (_ending, source, input, ended) => {
    expect(await poolOf().run(request(source, input))).toMatchObject(ended);
  });

  it('recurses as deep as its fixed bound on every host, since its worker has a stack of a fixed size', async () => {
    const recursion = 'def g: if . == 0 then 0 else (. - 1 | g) end; g';
    const pool = poolOf();

    expect(await pool.run(request(recursion, 500))).toMatchObject({ ran: 'answered', output: 0 });
    expect(await pool.run(request(recursion, 1500))).toMatchObject({ ran: 'answered', output: 0 });
    expect(await pool.run(request(recursion, 3000))).toMatchObject({
      ran: 'raised',
      issue: { detail: 'Max depth exceeded', error: 'RuntimeError' },
    });
  });

  it('answers the size of an output larger than it may give, without the output', async () => {
    expect(await poolOf().run(request('"x" * 100', null, { mostOutputBytes: 50 }))).toMatchObject({
      ran: 'oversized',
      bytes: 102,
    });
  });

  it('answers that the input nests too deep', async () => {
    const deep = Array.from({ length: 600 }).reduce<Json>((inner) => [inner], null);

    expect(await poolOf().run(request('.', deep))).toMatchObject({ ran: 'exhausted', limit: 'value depth' });
  });
});

describe('the deadline and the memory of a worker', { timeout: poolTestTimeoutMs }, () => {
  it('terminate a worker at the deadline, while the server goes on answering others', async () => {
    const settled = { stuck: false };
    const stuck = poolOf({ worker: blocking })
      .run(request('.', null, { deadlineMs: 1500 }))
      .then((outcome) => {
        settled.stuck = true;
        return outcome;
      });

    const meanwhile = await poolOf().run(request('. + 1', 1));

    expect(meanwhile).toMatchObject({ ran: 'answered', output: 2 });
    expect(settled.stuck).toBe(false);
    const ended = await stuck;
    expect(ended).toMatchObject({ ran: 'stopped', because: 'deadline' });
    expect(ended.milliseconds).toBeGreaterThanOrEqual(1500 - timerSlackMs);
  });

  it('stop a run that takes more memory than its worker has', async () => {
    expect(await poolOf({ heapMegabytes: 16 }).run(request('[range(1000000) | {a: .}] | length'))).toMatchObject({
      ran: 'stopped',
      because: 'memory',
    });
  });
});

describe('the workers of a pool', { timeout: poolTestTimeoutMs }, () => {
  it('turn away a fifth run while four take every worker, once it has waited until its deadline', async () => {
    const pool = poolOf({ worker: blocking });
    const four = Array.from({ length: 4 }, () => pool.run(request('.', null, { deadlineMs: 5000 })));

    const fifth = await pool.run(request('.', null, { deadlineMs: 300 }));

    expect(fifth).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(fifth.milliseconds).toBeGreaterThanOrEqual(300 - timerSlackMs);
    await pool.close();
    expect(await Promise.all(four)).toMatchObject(
      Array.from({ length: 4 }, () => ({ ran: 'stopped', because: 'closing' })),
    );
  });
});

describe('a worker that breaks', { timeout: poolTestTimeoutMs }, () => {
  it.each([
    ['throws', 'throw new Error("broken on purpose")', 'The worker failed: broken on purpose'],
    ['ends', 'process.exit(3)', 'The worker ended with code 3 before it answered'],
    [
      'answers with something else',
      'import { parentPort } from "node:worker_threads"; parentPort.postMessage({ nonsense: true });',
      'The worker answered with something that is not an answer',
    ],
  ])('is answered as crashed when it %s', async (_crash, source, detail) => {
    expect(await poolOf({ worker: workerOf(source) }).run(request('.'))).toMatchObject({ ran: 'crashed', detail });
  });
});

describe('a run of the pool that is cancelled', { timeout: poolTestTimeoutMs }, () => {
  it('stops its worker', async () => {
    const cancelling = new AbortController();
    const run = poolOf({ worker: blocking }).run(request('.'), cancelling.signal);

    await setTimeout(50);
    cancelling.abort();

    expect(await run).toMatchObject({ ran: 'stopped', because: 'cancelled' });
  });

  it('starts no worker when it was cancelled before it was admitted', async () => {
    const pool = poolOf({ workers: 1, worker: blocking });
    const first = pool.run(request('.', null, { deadlineMs: 2000 }));
    const cancelling = new AbortController();
    const waiting = pool.run(request('.'), cancelling.signal);

    cancelling.abort();

    expect(await waiting).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    await pool.close();
    expect(await first).toMatchObject({ ran: 'stopped', because: 'closing' });
  });

  it('starts no worker when it comes already cancelled', async () => {
    const cancelling = new AbortController();
    cancelling.abort();

    expect(await poolOf({ worker: blocking }).run(request('.'), cancelling.signal)).toMatchObject({
      ran: 'stopped',
      because: 'cancelled',
    });
  });
});

describe('a closed pool', { timeout: poolTestTimeoutMs }, () => {
  it('takes no more runs', async () => {
    const pool = poolOf();
    await pool.close();

    expect(await pool.run(request('.'))).toMatchObject({ ran: 'stopped', because: 'closing' });
  });
});
