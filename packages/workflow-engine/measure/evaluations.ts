import { Effect } from 'effect';

import { machineSandboxOf, programPool } from '../src/dsl.ts';
import { filterVerdictsOf } from '../src/filters/filter-verdicts.ts';
import { decidedOnce } from '../src/pool-testing/decided-once.ts';
import { answerGraceMs } from '../src/program-pool/evaluation-thread.ts';
import type { MachineSandbox } from '../src/programs/reserved-instances.ts';
import { medianMillisecondsOf, startedAt } from './common.ts';

const decision = { decision: { decision: 'approve', reason: 'the budget is stated' } };

function churnOf(bytes: number): string {
  return `(() => { const big = "x".repeat(${bytes}); let total = 0; for (let round = 0; round < 1000000; round += 1) { total += JSON.stringify([big, round]).length; } return total > 0; })()`;
}

function churning(bytes: number): string {
  return `do:\n  - churn: { set: { churned: '\${ ${churnOf(bytes)} }' } }`;
}

function formatted(value: number, digits: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

async function timed(work: () => unknown): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

function evaluationMs(sandbox: MachineSandbox): number {
  const unit = sandbox.unit();
  const milliseconds = medianMillisecondsOf(201, () => {
    unit.evaluate(
      '$context.decision.decision == "approve"',
      { context: decision },
      {
        budget: 250,
        deadlineAt: sandbox.clock() + 2000,
        moment: 0,
      },
    );
  });
  unit.close();
  return milliseconds;
}

export async function evaluationsMeasured(): Promise<readonly string[]> {
  const pool = programPool({ workers: 1, heapMegabytes: 256 });
  const { machine, filters } = pool.evaluations;
  const coldMs = await timed(() => Effect.runPromise(machine.reserve));
  const inWorker = evaluationMs(machine);
  const here = machineSandboxOf();
  await Effect.runPromise(here.reserve);
  const inThread = evaluationMs(here);
  const decideMs = await timed(() => decidedOnce(machine, churning(4_194_304), startedAt));
  const replacedMs = await timed(() => Effect.runPromise(machine.reserve));
  const filter = { reference: '/churn', attributes: { type: 'com.acme.closed', data: `\${ ${churnOf(4_194_304)} }` } };
  const filterMs = await timed(() => filterVerdictsOf([filter], { type: 'com.acme.closed' }, filters, startedAt));
  await Effect.runPromise(here.reserve);
  const heldMs = await timed(() => decidedOnce(here, churning(1_048_576), startedAt));
  await pool.close();
  return [
    `the evaluation worker: ready ${formatted(coldMs, 1)} ms after its first input asked; an expression through it ${formatted(inWorker, 3)} ms at the median of 201, against ${formatted(inThread, 3)} ms on the thread that decides`,
    `a 4 MiB churn of JSON.stringify in an expression ended after ${formatted(decideMs, 0)} ms through decide and ${formatted(filterMs, 0)} ms through a trigger filter, each 2 s deadline and its ${answerGraceMs} ms of grace; the replacement worker was ready ${formatted(replacedMs, 1)} ms later; a 1 MiB churn on the thread that decides held it ${formatted(heldMs, 0)} ms`,
  ];
}
