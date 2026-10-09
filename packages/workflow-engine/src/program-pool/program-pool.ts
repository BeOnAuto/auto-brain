import { Schema, Struct } from 'effect';

import { CheckAnswerSchema, type CheckAnswer } from '../jobs/check-messages.ts';
import { stopped, type Ending } from '../jobs/job-endings.ts';
import type { CheckRequest, PoolSettings, ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { ProgramAnswerSchema, type ProgramAnswer } from '../jobs/program-messages.ts';
import { foldJobOf } from './fold-job.ts';
import type { Job } from './pool-job.ts';
import { poolSlots, type PoolSlots } from './pool-slots.ts';
import { poolWorkers } from './pool-workers.ts';

export const checkPermits = 1;

const programWorker = new URL('../workers/program-worker.ts', import.meta.url);

const foldWorker = new URL('../workers/fold-worker.ts', import.meta.url);

const decodeProgramAnswer = Schema.decodeUnknownOption(ProgramAnswerSchema);

const decodeCheckAnswer = Schema.decodeUnknownOption(CheckAnswerSchema);

function programJob(module: Readonly<URL>, request: ProgramRequest, until: number): Job<ProgramAnswer> {
  const job = {
    ...Struct.pick(request, ['source', 'entry', 'moment', 'budget', 'memoryBytes', 'stackBytes', 'mostOutputBytes']),
    arguments: request.arguments.map((argument) => JSON.stringify(argument)),
    deadlineAt: performance.timeOrigin + until,
    context: request.context ?? null,
  };
  return {
    module,
    envelope: (id) => ({ job: id, kind: 'program', request: job }),
    decode: decodeProgramAnswer,
  };
}

function checkJob(module: Readonly<URL>, request: CheckRequest): Job<CheckAnswer> {
  const job = Struct.omit(request, ['deadlineMs', 'worker']);
  return {
    module,
    envelope: (id) => ({ job: id, kind: 'check', request: job }),
    decode: decodeCheckAnswer,
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
  const checkSlots = poolSlots(checkPermits);
  const workers = poolWorkers(settings);
  const checkers = poolWorkers({ ...settings, workers: checkPermits });
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
    check: async (request, signal) => {
      const started = performance.now();
      const until = started + request.deadlineMs;
      const module = settings.worker ?? request.worker;
      const ending = await admitted(checkSlots, until, signal, () =>
        checkers.evaluate(checkJob(module, request), { until, signal }),
      );
      return { ...ending, milliseconds: performance.now() - started };
    },
    close: async () => {
      slots.close();
      checkSlots.close();
      await Promise.all([workers.close(), checkers.close()]);
    },
  };
}
