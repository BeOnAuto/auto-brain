import { Worker, type WorkerOptions } from 'node:worker_threads';

import { Option, Schema } from 'effect';

import { mostValueDepth, type Json } from '../dsl/json.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { ProgramLimits } from '../programs/program-running.ts';
import { fieldOf, textOf } from '../programs/program-tree.ts';
import { poolSlots, type PoolSlots } from './pool-slots.ts';
import { ProgramAnswerSchema, type ProgramAnswer } from './program-messages.ts';

export interface PoolSettings {
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly worker?: Readonly<URL>;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface ProgramRequest {
  readonly source: string;
  readonly input: Json;
  readonly dialect: Dialect;
  readonly limits: ProgramLimits;
  readonly deadlineMs: number;
  readonly mostOutputBytes: number;
  readonly worker?: Readonly<URL>;
  readonly context?: Json;
}

export type Stopped = 'deadline' | 'memory' | 'busy' | 'cancelled' | 'closing';

type Ending =
  | ProgramAnswer
  | { readonly ran: 'stopped'; readonly because: Stopped }
  | { readonly ran: 'crashed'; readonly detail: string };

export type PoolOutcome = Ending & { readonly milliseconds: number };

export interface ProgramPool {
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly run: (request: ProgramRequest, signal?: Readonly<AbortSignal>) => Promise<PoolOutcome>;
  readonly close: () => Promise<void>;
}

interface Watch {
  readonly ending: Promise<Ending>;
  readonly answered: (message: unknown) => void;
  readonly failed: (error: unknown) => void;
  readonly exited: (code: number) => void;
  readonly done: () => void;
}

interface Asked {
  readonly request: ProgramRequest;
  readonly until: number;
  readonly signal?: Readonly<AbortSignal> | undefined;
}

type Evaluate = (asked: Asked) => Promise<Ending>;

export const workerStackMegabytes = 64;

export const mostEvaluationDepth = 10_000;

const programWorker = new URL('./program-worker.ts', import.meta.url);

const decodeAnswer = Schema.decodeUnknownOption(ProgramAnswerSchema);

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

function stopped(because: Stopped): Ending {
  return { ran: 'stopped', because };
}

function answeredWith(message: unknown): Ending {
  return Option.getOrElse(decodeAnswer(message), (): Ending => ({
    ran: 'crashed',
    detail: 'The worker answered with something that is not an answer',
  }));
}

function failedWith(error: unknown): Ending {
  return fieldOf(error, 'code') === outOfMemory
    ? stopped('memory')
    : { ran: 'crashed', detail: `The worker failed: ${textOf(error, 'message')}` };
}

function watchUntil(until: number, closing: () => boolean, signal: Readonly<AbortSignal> | undefined): Watch {
  const { promise, resolve } = Promise.withResolvers<Ending>();
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
      resolve(answeredWith(message));
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

function workerOptions(request: ProgramRequest, until: number, settings: PoolSettings): WorkerOptions {
  const { source, input, dialect, limits, mostOutputBytes, context = null } = request;
  return {
    workerData: {
      source,
      input: JSON.stringify(input),
      dialect,
      limits,
      mostOutputBytes,
      context,
      deadlineAt: performance.timeOrigin + until,
    },
    resourceLimits: { maxOldGenerationSizeMb: settings.heapMegabytes, stackSizeMb: workerStackMegabytes },
    env: { ...settings.environment },
  };
}

async function admittedRun(slots: PoolSlots, evaluate: Evaluate, asked: Asked): Promise<Ending> {
  const admission = await slots.admit(asked.until, asked.signal);
  if (admission !== 'admitted') {
    return stopped(admission);
  }
  try {
    return asked.signal?.aborted === true ? stopped('cancelled') : await evaluate(asked);
  } finally {
    slots.release();
  }
}

export function programPool(settings: PoolSettings): ProgramPool {
  const slots = poolSlots(settings.workers);
  const stops = new Set<() => Promise<number>>();
  const state = { closing: false };
  const evaluate: Evaluate = async ({ request, until, signal }) => {
    const module = new URL((settings.worker ?? request.worker ?? programWorker).href);
    const worker = new Worker(module, workerOptions(request, until, settings));
    const stop = (): Promise<number> => worker.terminate();
    stops.add(stop);
    const watch = watchUntil(until, () => state.closing, signal);
    worker.once('message', watch.answered).once('error', watch.failed).once('exit', watch.exited);
    const ending = await watch.ending;
    watch.done();
    await stop();
    stops.delete(stop);
    return ending;
  };
  return {
    workers: settings.workers,
    heapMegabytes: settings.heapMegabytes,
    run: async (request, signal) => {
      const started = performance.now();
      const ending = await admittedRun(slots, evaluate, { request, until: started + request.deadlineMs, signal });
      return { ...ending, milliseconds: performance.now() - started };
    },
    close: async () => {
      state.closing = true;
      slots.close();
      await Promise.all([...stops].map((stop) => stop()));
    },
  };
}
