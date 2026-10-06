import { Worker, type WorkerOptions } from 'node:worker_threads';

import { Option, Schema } from 'effect';

import { mostValueDepth, type Json } from '../dsl/json.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { ProgramLimits, Variables } from '../programs/program-running.ts';
import { fieldOf, textOf } from '../programs/program-tree.ts';
import { foldJobOf, type FoldOutcome, type FoldRequest } from './fold-job.ts';
import { stopped, type Ending, type Evaluate, type Interrupted, type Job, type Running } from './pool-job.ts';
import { poolSlots, type PoolSlots } from './pool-slots.ts';
import { ProgramAnswerSchema, type ProgramAnswer } from './program-messages.ts';

export type { FoldOutcome, FoldRequest } from './fold-job.ts';
export type { Stopped } from './pool-job.ts';

export interface PoolSettings {
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly worker?: Readonly<URL>;
  readonly foldWorker?: Readonly<URL>;
}

export interface ProgramRequest {
  readonly source: string;
  readonly input: Json;
  readonly variables?: Variables;
  readonly dialect: Dialect;
  readonly limits: ProgramLimits;
  readonly deadlineMs: number;
  readonly mostOutputBytes: number;
}

export type PoolOutcome = Ending<ProgramAnswer> & { readonly milliseconds: number };

export interface ProgramPool {
  readonly workers: number;
  readonly run: (request: ProgramRequest, signal?: Readonly<AbortSignal>) => Promise<PoolOutcome>;
  readonly fold: (request: FoldRequest, signal?: Readonly<AbortSignal>) => Promise<FoldOutcome>;
  readonly close: () => Promise<void>;
}

interface Watch<Answer> {
  readonly ending: Promise<Ending<Answer>>;
  readonly answered: (message: unknown) => void;
  readonly failed: (error: unknown) => void;
  readonly exited: (code: number) => void;
  readonly done: () => void;
}

export const workerStackMegabytes = 64;

export const mostEvaluationDepth = 10_000;

const programWorker = new URL('./program-worker.ts', import.meta.url);

const foldWorker = new URL('./fold-worker.ts', import.meta.url);

const decodeProgramAnswer = Schema.decodeUnknownOption(ProgramAnswerSchema);

const outOfMemory = 'ERR_WORKER_OUT_OF_MEMORY';

export function liftedLimits(mostWork: number): ProgramLimits {
  return {
    mostWork,
    mostSteps: Number.POSITIVE_INFINITY,
    mostOutputs: Number.POSITIVE_INFINITY,
    mostDepth: mostEvaluationDepth,
    mostValueDepth,
  };
}

function failedWith(error: unknown): Interrupted {
  return fieldOf(error, 'code') === outOfMemory
    ? stopped('memory')
    : { ran: 'crashed', detail: `The worker failed: ${textOf(error, 'message')}` };
}

function watchUntil<Answer>(
  { until, signal }: Running,
  closing: () => boolean,
  decode: Job<Answer>['decode'],
): Watch<Answer> {
  const { promise, resolve } = Promise.withResolvers<Ending<Answer>>();
  const timer = setTimeout(() => {
    resolve(stopped('deadline'));
  }, until - performance.now());
  const cancel = (): void => {
    resolve(stopped('cancelled'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  return {
    ending: promise,
    answered: (message) => {
      resolve(
        Option.getOrElse(decode(message), (): Ending<Answer> => ({
          ran: 'crashed',
          detail: 'The worker answered with something that is not an answer',
        })),
      );
    },
    failed: (error) => {
      resolve(failedWith(error));
    },
    exited: (code) => {
      resolve(
        closing()
          ? stopped('closing')
          : { ran: 'crashed', detail: `The worker ended with code ${code} before it answered` },
      );
    },
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    },
  };
}

function workerOptions(workerData: unknown, heapMegabytes: number): WorkerOptions {
  return { workerData, resourceLimits: { maxOldGenerationSizeMb: heapMegabytes, stackSizeMb: workerStackMegabytes } };
}

function programJob(module: Readonly<URL>, request: ProgramRequest, until: number): Job<ProgramAnswer> {
  const { variables = {}, ...rest } = request;
  return {
    module,
    workerData: {
      ...rest,
      input: JSON.stringify(request.input),
      variables: JSON.stringify(variables),
      deadlineAt: performance.timeOrigin + until,
    },
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
  const stops = new Set<() => Promise<number>>();
  const state = { closing: false };
  const programModule = new URL((settings.worker ?? programWorker).href);
  const foldModule = new URL((settings.foldWorker ?? foldWorker).href);
  const evaluate: Evaluate = async (job, running) => {
    const worker = new Worker(job.module, workerOptions(job.workerData, settings.heapMegabytes));
    const stop = (): Promise<number> => worker.terminate();
    stops.add(stop);
    const watch = watchUntil(running, () => state.closing, job.decode);
    worker.once('message', watch.answered).once('error', watch.failed).once('exit', watch.exited);
    const ending = await watch.ending;
    watch.done();
    await stop();
    stops.delete(stop);
    return ending;
  };
  return {
    workers: settings.workers,
    run: async (request, signal) => {
      const started = performance.now();
      const until = started + request.deadlineMs;
      const ending = await admitted(slots, until, signal, () =>
        evaluate(programJob(programModule, request, until), { until, signal }),
      );
      return { ...ending, milliseconds: performance.now() - started };
    },
    fold: async (request, signal) => {
      const started = performance.now();
      const job = foldJobOf(foldModule, evaluate, request, signal);
      const ending = await admitted(slots, started + job.waitMs, signal, job.run);
      return { ...ending, milliseconds: performance.now() - started };
    },
    close: async () => {
      state.closing = true;
      slots.close();
      await Promise.all([...stops].map((stop) => stop()));
    },
  };
}
