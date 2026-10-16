import { afterEach, describe, expect, it } from 'vitest';

import { mostFilterMs } from '../dsl/evaluation.ts';
import type { PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { churningFilter, closed, evaluatedAt, plainFilter } from '../pool-testing/churning-filters.ts';
import { announcingEvaluations, replacedByTheDeadlineOf } from '../pool-testing/evaluation-workers.ts';
import { programPool } from '../program-pool/program-pool.ts';
import { filterVerdictsOf } from './filter-verdicts.ts';

const timerMs = 20;

const pools: ProgramPool[] = [];

const coverage = process.env['NODE_V8_COVERAGE'];

const measured = coverage === undefined ? {} : { NODE_V8_COVERAGE: coverage };

function european(reference: string): typeof plainFilter {
  return { ...plainFilter, reference };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ workers: 1, heapMegabytes: 64, environment: measured, ...settings });
  pools.push(pool);
  return pool;
}

describe('the filter worker of a pool, given native work that no checkpoint interrupts', () => {
  it('ends a trigger filter at its own deadline of 200 ms, stopped, and matches the filter after it on a fresh worker', async () => {
    const { filters } = poolOf({ evaluationWorker: announcingEvaluations }).evaluations;
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);

    const { answer, replacedAfterMs } = await replacedByTheDeadlineOf('test', mostFilterMs, () =>
      filterVerdictsOf([churningFilter, plainFilter], closed, filters, evaluatedAt),
    );

    expect(answer).toMatchObject([{ error: { status: 500, instance: '/churn' }, stopped: true }, true]);
    expect(JSON.stringify(answer)).toContain(
      `The program ran past its deadline: one filter may take ${mostFilterMs} ms`,
    );
    expect(replacedAfterMs).toBeGreaterThan(mostFilterMs);
  });

  it("leaves the main thread free while a plain filter and a churning one after it are matched, so the main thread's timer fires on schedule", async () => {
    const { filters } = poolOf().evaluations;
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);
    const order: string[] = [];

    const fired = new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push('timer');
        resolve();
      }, timerMs);
    });
    const matched = filterVerdictsOf([plainFilter, churningFilter], closed, filters, evaluatedAt).then((verdicts) => {
      order.push('verdicts');
      return verdicts;
    });
    await Promise.all([fired, matched]);

    expect(timerMs).toBeLessThan(mostFilterMs);
    expect(order).toEqual(['timer', 'verdicts']);
    expect(await matched).toMatchObject([true, { stopped: true }]);
  });
});

describe('the filter worker of a pool, matching groups at the same time', () => {
  it('prepares again on the fresh worker the groups prepared on the worker a churning filter ended, so groups matched at the same time still match', async () => {
    const { filters } = poolOf().evaluations;
    await filterVerdictsOf([plainFilter], closed, filters, evaluatedAt);

    const verdicts = await Promise.all([
      filterVerdictsOf([churningFilter], closed, filters, evaluatedAt),
      filterVerdictsOf([european('/first')], closed, filters, evaluatedAt),
      filterVerdictsOf([european('/second')], closed, filters, evaluatedAt),
      filterVerdictsOf([european('/third')], closed, filters, evaluatedAt),
    ]);

    expect(verdicts).toMatchObject([[{ stopped: true }], [true], [true], [true]]);
  });
});
