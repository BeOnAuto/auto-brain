import { setTimeout } from 'node:timers/promises';

import { idleWorkerMs, programPool, type ProgramPool, type ProgramRequest } from '@beonauto/workflow-engine/dsl';

import { checkedWorker } from '../src/checking/value-checks.ts';
import { computationDialect } from '../src/document/program-dialect.ts';
import { computationBounds, computationLimits } from '../src/run/run-bounds.ts';
import { formatted, inTurn, median, millisecondsOf } from './common.ts';

const warmRuns = 30;

const freshPools = 9;

const checked = { worker: checkedWorker, context: { type: 'integer' } };

export function request(
  source: string,
  input: number | null,
  deadlineMs: number = computationBounds.deadlineMs,
): ProgramRequest {
  return {
    source,
    input,
    dialect: computationDialect,
    limits: computationLimits,
    deadlineMs,
    mostOutputBytes: 1_000_000,
  };
}

export function poolOfOne(): ProgramPool {
  return programPool({ workers: 1, heapMegabytes: computationBounds.heapMegabytes });
}

async function firstJobOf(more: Partial<ProgramRequest>): Promise<number> {
  const pool = poolOfOne();
  const { milliseconds } = await pool.run({ ...request('.', 0), ...more });
  await pool.close();
  return milliseconds;
}

async function warmRunsOf(more: Partial<ProgramRequest>): Promise<readonly number[]> {
  const pool = poolOfOne();
  await pool.run({ ...request('.', 0), ...more });
  const indexes = Array.from({ length: warmRuns }, (_, index) => index + 1);
  const warm = await inTurn(
    indexes,
    async (index) => (await pool.run({ ...request('.', index), ...more })).milliseconds,
  );
  await pool.close();
  return warm;
}

function roundTripOfARequest(): number {
  const job = {
    job: 1,
    kind: 'program',
    request: { ...request('.', 1), input: '1', variables: '{}', deadlineAt: 0, context: checked.context },
  };
  return median(
    Array.from({ length: 1000 }, () =>
      millisecondsOf(() => {
        JSON.parse(JSON.stringify(job));
      }),
    ),
  );
}

export async function runsMeasured(): Promise<readonly string[]> {
  const cold = await inTurn(Array.from({ length: freshPools }), () => firstJobOf({}));
  const coldChecked = await inTurn(Array.from({ length: freshPools }), () => firstJobOf(checked));
  const plain = await warmRunsOf({});
  const withASchema = await warmRunsOf(checked);
  return [
    `the first job of a worker, cold, a program that answers at once: ${formatted(median(cold), 1)} ms at the median of ${cold.length} fresh pools, ${formatted(median(coldChecked), 1)} ms with an output schema`,
    `a warm run of a program that answers at once: ${formatted(median(plain), 2)} ms at the median of ${plain.length}`,
    `the same with an output schema, checked in its warm worker: ${formatted(median(withASchema), 2)} ms at the median of ${withASchema.length}`,
    `the JSON round trip of the request of such a run, on the thread that measures: ${formatted(roundTripOfARequest(), 4)} ms at the median of 1,000`,
  ];
}

export async function idleMeasured(): Promise<string> {
  const pool = poolOfOne();
  await pool.run(request('.', 0));
  await setTimeout(idleWorkerMs + 1000);
  const { milliseconds } = await pool.run(request('.', 1));
  await pool.close();
  return `a job after its worker was idle past its ${formatted(idleWorkerMs / 1000)} s, cold again: ${formatted(milliseconds, 1)} ms`;
}
