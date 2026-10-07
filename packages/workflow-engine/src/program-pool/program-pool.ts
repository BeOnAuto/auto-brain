import { Schema } from 'effect';

import { mostValueDepth } from '../dsl/json.ts';
import { stopped, type Ending } from '../jobs/job-endings.ts';
import type { PoolSettings, ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { ProgramAnswerSchema, type ProgramAnswer } from '../jobs/program-messages.ts';
import type { ProgramLimits } from '../programs/program-running.ts';
import { foldJobOf } from './fold-job.ts';
import type { Job } from './pool-job.ts';
import { poolSlots, type PoolSlots } from './pool-slots.ts';
import { poolWorkers } from './pool-workers.ts';

export const mostEvaluationDepth = 10_000;

const programWorker = new URL('./program-worker.ts', import.meta.url);

const foldWorker = new URL('./fold-worker.ts', import.meta.url);

const decodeProgramAnswer = Schema.decodeUnknownOption(ProgramAnswerSchema);

export function liftedLimits(mostWork: number): ProgramLimits {
  return {
    mostWork,
    mostSteps: Number.POSITIVE_INFINITY,
    mostOutputs: Number.POSITIVE_INFINITY,
    mostDepth: mostEvaluationDepth,
    mostValueDepth,
  };
}

function programJob(module: Readonly<URL>, request: ProgramRequest, until: number): Job<ProgramAnswer> {
  const { source, input, variables = {}, dialect, limits, mostOutputBytes, context = null } = request;
  const job = {
    source,
    input: JSON.stringify(input),
    variables: JSON.stringify(variables),
    dialect,
    limits,
    mostOutputBytes,
    deadlineAt: performance.timeOrigin + until,
    context,
  };
  return {
    module,
    envelope: (id) => ({ job: id, kind: 'program', request: job }),
    decode: decodeProgramAnswer,
  };
}

async function admitted<Answer>(
  slots: PoolSlots,
  admitUntil: number,
  signal: Readonly<AbortSignal> | undefined,
  evaluate: () => Promise<Ending<Answer>>,
): Promise<Ending<Answer>> {
  const admission = await slots.admit(admitUntil, signal);
  if (admission !== 'admitted') {
    return stopped(admission);
  }
  try {
    return signal?.aborted === true ? stopped('cancelled') : await evaluate();
  } finally {
    slots.release();
  }
}

export function programPool(settings: PoolSettings): ProgramPool {
  const slots = poolSlots(settings.workers);
  const workers = poolWorkers(settings);
  return {
    workers: settings.workers,
    heapMegabytes: settings.heapMegabytes,
    run: async (request, signal) => {
      const started = performance.now();
      const until = started + request.deadlineMs;
      const module = settings.worker ?? request.worker ?? programWorker;
      const ending = await admitted(slots, until, signal, () =>
        workers.evaluate(programJob(module, request, until), { until, signal }),
      );
      return { ...ending, milliseconds: performance.now() - started };
    },
    fold: async (request, signal) => {
      const started = performance.now();
      const job = foldJobOf(settings.foldWorker ?? request.worker ?? foldWorker, workers.evaluate, request, signal);
      const ending = await admitted(slots, started + job.waitMs, signal, job.run);
      return { ...ending, milliseconds: performance.now() - started };
    },
    close: async () => {
      slots.close();
      await workers.close();
    },
  };
}
