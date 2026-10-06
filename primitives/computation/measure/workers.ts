import { Worker } from 'node:worker_threads';

import {
  liftedLimits,
  mostEvaluationDepth,
  programPool,
  workerStackMegabytes,
  type ProgramPool,
} from '@beonauto/workflow-engine/dsl';
import { Schema } from 'effect';

import { computationDialect } from '../src/document/program-dialect.ts';
import { computationBounds, computationLimits } from '../src/run/run-bounds.ts';
import { formatted, inTurn, median } from './common.ts';

const recursion = 'def g: if . == 0 then 0 else (. - 1 | g) end; g';

const blocking = new URL(`data:text/javascript,${encodeURIComponent('while (true) {}')}`);

const decodeHeap = Schema.decodeUnknownSync(Schema.Struct({ ran: Schema.String, heap: Schema.Number }));

const allocating = [
  '[range(1000000) | {a: .}] | length',
  '[range(0; 2000000; 0.5)] | length',
  '"ā" * 30000000 | length',
  '"\\u0001" * 31000000 | tojson | length',
  '("[]," * 1000000) as $t | "[" + $t + "[]]" | fromjson | length',
  '[range(200000) | tostring] | join(",") | length',
];

function request(source: string, input: number | null, deadlineMs: number = computationBounds.deadlineMs) {
  return {
    source,
    input,
    dialect: computationDialect,
    limits: computationLimits,
    deadlineMs,
    mostOutputBytes: 1_000_000,
  };
}

async function startup(pool: ProgramPool): Promise<string> {
  const samples = await inTurn(
    Array.from({ length: 30 }, (_, index) => index),
    async (index) => (await pool.run(request('.', index))).milliseconds,
  );
  return `a run of a program that answers at once, worker started and ended: ${formatted(median(samples), 1)} ms at the median of ${samples.length}`;
}

async function termination(): Promise<string> {
  const pool = programPool({ workers: 1, heapMegabytes: computationBounds.heapMegabytes, worker: blocking });
  const ended = await pool.run(request('.', 1, 500));
  await pool.close();
  return `a worker that never answers, under a deadline of 500 ms: ended ${ended.ran}, after ${formatted(ended.milliseconds, 1)} ms`;
}

async function deepestBetween(pool: ProgramPool, mostDepth: number, low: number, high: number): Promise<number> {
  if (low >= high) {
    return low;
  }
  const middle = Math.ceil((low + high) / 2);
  const limits = { ...liftedLimits(computationLimits.mostWork * 100), mostDepth };
  const ended = await pool.run({ ...request(recursion, middle), limits });
  return ended.ran === 'answered'
    ? deepestBetween(pool, mostDepth, middle, high)
    : deepestBetween(pool, mostDepth, low, middle - 1);
}

function deepestRecursion(pool: ProgramPool, mostDepth: number): Promise<number> {
  return deepestBetween(pool, mostDepth, 1, 60_000);
}

function heapOf(source: string): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const worker = new Worker(new URL('./heap-worker.ts', import.meta.url), {
    workerData: source,
    resourceLimits: { maxOldGenerationSizeMb: computationBounds.heapMegabytes, stackSizeMb: workerStackMegabytes },
  });
  worker.once('message', (message: unknown) => {
    const { ran, heap } = decodeHeap(message);
    resolve(`  ${source}: ended ${ran}, its heap grown to ${formatted(heap / 1_048_576, 1)} MiB`);
  });
  worker.once('error', (error: unknown) => {
    resolve(`  ${source}: ${String(error)}`);
  });
  return promise;
}

export async function workersMeasured(): Promise<readonly string[]> {
  const pool = programPool({ workers: 1, heapMegabytes: computationBounds.heapMegabytes });
  const lines = [
    await startup(pool),
    await termination(),
    `the deepest recursion of ${recursion} within the bound of ${formatted(mostEvaluationDepth)} levels of evaluation: ${formatted(await deepestRecursion(pool, mostEvaluationDepth))} calls`,
    `the deepest it reaches in a worker's stack of ${workerStackMegabytes} MiB with no bound: ${formatted(await deepestRecursion(pool, Number.POSITIVE_INFINITY))} calls`,
    `the heap of a worker of ${computationBounds.heapMegabytes} MiB after runs that allocate much for their work:`,
  ];
  const heaps = await inTurn(allocating, heapOf);
  await pool.close();
  return [...lines, ...heaps];
}
