import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { filterVerdictsOf } from '../filters/filter-verdicts.ts';
import type { PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { decidedOnce } from '../pool-testing/decided-once.ts';
import { threadsAlive } from '../pool-testing/threads-alive.ts';
import type { Evaluation, ProgramRun } from '../programs/program-run.ts';
import { workflow } from '../testing/workflows.ts';
import { answerGraceMs } from './evaluation-thread.ts';
import { programPool } from './program-pool.ts';

type Machine = ProgramPool['evaluations']['machine'];

const evaluationTestTimeoutMs = 30_000;

const pools: ProgramPool[] = [];

const coverage = process.env['NODE_V8_COVERAGE'];

const measured = coverage === undefined ? {} : { NODE_V8_COVERAGE: coverage };

const now = Date.parse('2026-10-01T09:00:00.000Z');

const churn =
  '(() => { const big = "x".repeat(4194304); let total = 0; for (let round = 0; round < 1000000; round += 1) { total += JSON.stringify([big, round]).length; } return total > 0; })()';

const filling = '(() => { const kept = []; for (;;) { kept.push("x".repeat(1048576) + kept.length); } })()';

const caughtStackBomb =
  '(() => { const deeper = (depth) => { try { return deeper(depth + 1); } catch { return depth; } }; return deeper(0); })()';

const closed = { type: 'com.acme.closed', data: { region: 'eu' } };

const churningFilter = { reference: '/churn', attributes: { type: 'com.acme.closed', data: `\${ ${churn} }` } };

const plainFilter = { reference: '/plain', attributes: { type: 'com.acme.closed', data: '${ $data.region == "eu" }' } };

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ workers: 1, heapMegabytes: 64, environment: measured, ...settings });
  pools.push(pool);
  return pool;
}

function within(machine: Machine, milliseconds: number): Evaluation {
  return { budget: 250, deadlineAt: machine.clock() + milliseconds, moment: now };
}

function evaluatedIn(machine: Machine, source: string, milliseconds = 2000): ProgramRun {
  const unit = machine.unit();
  try {
    return unit.evaluate(source, {}, within(machine, milliseconds));
  } finally {
    unit.close();
  }
}

function nested<Answer>(depth: number, then: () => Answer): Answer {
  return depth === 0 ? then() : nested(depth - 1, then);
}

async function timed<Answer>(work: () => Answer | Promise<Answer>): Promise<{ answer: Answer; ms: number }> {
  const started = performance.now();
  const answer = await work();
  return { answer, ms: performance.now() - started };
}

describe(
  'the evaluation worker of a pool, given native work that no checkpoint interrupts',
  { timeout: evaluationTestTimeoutMs },
  () => {
    it('ends the expression of a decision at the input deadline, within about 2.1 s, and decides the next input on a fresh worker', async () => {
      const { machine } = poolOf().evaluations;
      const churning = workflow(`do:\n  - churn: { set: { churned: '\${ ${churn} }' } }`);
      await Effect.runPromise(machine.reserve);

      const { answer: ended, ms } = await timed(() => decidedOnce(machine, churning, now));
      await Effect.runPromise(machine.reserve);
      const next = decidedOnce(machine, workflow('do:\n  - add: { set: { sum: "${ 1 + 1 }" } }'), now);

      expect(ended.outcome).toMatchObject({ kind: 'raised', error: { status: 500 } });
      expect(JSON.stringify(ended.outcome)).toContain(
        'The program ran past its deadline: the expressions of one input may take 2000 ms',
      );
      expect(ms).toBeGreaterThan(2000);
      expect(ms).toBeLessThan(2000 + answerGraceMs + 400);
      expect(next.outcome).toEqual({ kind: 'completed', output: { sum: 2 } });
    });

    it('ends a trigger filter at its own deadline, within about 2.1 s, and matches the filters after it on a fresh worker', async () => {
      const { machine, filters } = poolOf().evaluations;
      await Effect.runPromise(machine.reserve);

      const { answer: alone, ms } = await timed(() => filterVerdictsOf([churningFilter], closed, filters, now));
      const together = await filterVerdictsOf([churningFilter, plainFilter], closed, filters, now);

      expect(alone).toMatchObject([{ error: { status: 500, instance: '/churn' } }]);
      expect(JSON.stringify(alone)).toContain('The program ran past its deadline: one filter may take 2000 ms');
      expect(ms).toBeGreaterThan(2000);
      expect(ms).toBeLessThan(2000 + answerGraceMs + 400);
      expect(together).toMatchObject([{ error: { status: 500 } }, true]);
    });
  },
);

describe(
  'the evaluation worker of a pool, given a stack or a memory to exhaust',
  { timeout: evaluationTestTimeoutMs },
  () => {
    it('gives a caught stack bomb the same answer from the shallow stack of the host as from 5,000 frames deep', async () => {
      const { machine } = poolOf().evaluations;
      await Effect.runPromise(machine.reserve);

      const shallow = evaluatedIn(machine, caughtStackBomb);
      const deep = nested(5000, () => evaluatedIn(machine, caughtStackBomb));

      expect(shallow).toMatchObject({ ran: 'answered' });
      expect(deep).toEqual(shallow);
    });

    it('ends a unit whose instance refused to grow, and answers the next unit on a fresh worker', async () => {
      const { machine } = poolOf().evaluations;
      await Effect.runPromise(machine.reserve);
      const unit = machine.unit();

      const runs = [
        unit.evaluate(filling, {}, within(machine, 10_000)),
        unit.evaluate('1 + 1', {}, within(machine, 10_000)),
      ];
      unit.close();
      await Effect.runPromise(machine.reserve);
      const next = evaluatedIn(machine, '1 + 1');

      expect(runs).toMatchObject([
        { ran: 'exhausted', limit: 'memory' },
        { ran: 'exhausted', limit: 'memory', work: 0 },
      ]);
      expect(next).toMatchObject({ ran: 'answered', text: '2' });
    });
  },
);

describe('the evaluation worker of a pool that cannot answer', { timeout: evaluationTestTimeoutMs }, () => {
  it('starts no worker once the pool closed, and ends an evaluation at once at its deadline', async () => {
    const pool = poolOf();
    await pool.close();
    const before = threadsAlive();

    await Effect.runPromise(pool.evaluations.machine.reserve);
    const { answer, ms } = await timed(() => evaluatedIn(pool.evaluations.machine, '1 + 1'));

    expect(answer).toMatchObject({ ran: 'exhausted', limit: 'deadline', work: 0 });
    expect(ms).toBeLessThan(100);
    expect(threadsAlive()).toBe(before);
  });

  it('ends an evaluation at its deadline while the worker it started has not loaded, and never ends a worker that is loading', async () => {
    const broken = new URL(`data:text/javascript,${encodeURIComponent("throw new Error('broken on purpose');")}`);
    const { machine } = poolOf({ evaluationWorker: broken }).evaluations;

    await Effect.runPromise(machine.reserve);
    const { answer, ms } = await timed(() => evaluatedIn(machine, '1 + 1', 200));

    expect(answer).toMatchObject({ ran: 'exhausted', limit: 'deadline', work: 0 });
    expect(ms).toBeGreaterThan(150);
    expect(ms).toBeLessThan(200 + answerGraceMs + 400);
  });
});
