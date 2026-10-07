import { Worker, type WorkerOptions } from 'node:worker_threads';

import { Option, Schema } from 'effect';

import { crashed, stopped, type Ending, type Interrupted } from '../jobs/job-endings.ts';
import { JobAnswerSchema } from '../jobs/job-envelopes.ts';
import type { PoolSettings } from '../jobs/pool-contract.ts';
import { fieldOf, textOf } from '../programs/program-tree.ts';
import type { Job, Running } from './pool-job.ts';

export const workerStackMegabytes = 64;

export interface Served<Answer> {
  readonly ending: Ending<Answer>;
  readonly keep: boolean;
}

export interface Thread {
  readonly module: string;
  readonly jobs: () => number;
  readonly serve: <Answer>(job: number, work: Job<Answer>, running: Running) => Promise<Served<Answer>>;
  readonly rest: (idleMs: number, tired: () => void) => void;
  readonly wake: () => void;
  readonly end: () => Promise<number>;
}

export interface ThreadHooks {
  readonly closing: () => boolean;
  readonly troubled: (thread: Thread) => void;
  readonly gone: (thread: Thread) => void;
}

interface ThreadEvents {
  readonly answered: (message: unknown) => void;
  readonly failed: (error: unknown) => void;
  readonly exited: (code: number) => void;
}

interface ThreadState {
  jobs: number;
  events?: ThreadEvents;
  resting?: ReturnType<typeof setTimeout>;
  ended?: Promise<number>;
}

interface Watch<Answer> {
  readonly served: Promise<Served<Answer>>;
  readonly events: ThreadEvents;
  readonly done: () => void;
}

const decodeJobAnswer = Schema.decodeUnknownOption(JobAnswerSchema);

const outOfMemory = 'ERR_WORKER_OUT_OF_MEMORY';

const notAnAnswer = 'The worker answered with something that is not an answer';

function failedWith(error: unknown): Interrupted {
  return fieldOf(error, 'code') === outOfMemory
    ? stopped('memory')
    : crashed(`The worker failed: ${textOf(error, 'message')}`);
}

function answerIn<Answer>(message: unknown, job: number, { decode }: Job<Answer>): Served<Answer> {
  const reply = decodeJobAnswer(message);
  if (Option.isNone(reply)) {
    return { ending: crashed(notAnAnswer), keep: false };
  }
  if (reply.value.job !== job) {
    return { ending: crashed(`The worker answered job ${reply.value.job} while it ran job ${job}`), keep: false };
  }
  return Option.match(decode(reply.value.answer), {
    onNone: (): Served<Answer> => ({ ending: crashed(notAnAnswer), keep: false }),
    onSome: (answer) => ({ ending: answer, keep: reply.value.keep }),
  });
}

function watchOf<Answer>(job: number, work: Job<Answer>, running: Running, closing: () => boolean): Watch<Answer> {
  const { promise, resolve } = Promise.withResolvers<Served<Answer>>();
  const ended = (ending: Ending<Answer>): void => {
    resolve({ ending, keep: false });
  };
  const timer = setTimeout(() => {
    ended(stopped('deadline'));
  }, running.until - performance.now());
  const cancel = (): void => {
    ended(stopped('cancelled'));
  };
  running.signal?.addEventListener('abort', cancel, { once: true });
  return {
    served: promise,
    events: {
      answered: (message) => {
        resolve(answerIn(message, job, work));
      },
      failed: (error) => {
        ended(failedWith(error));
      },
      exited: (code) => {
        ended(closing() ? stopped('closing') : crashed(`The worker ended with code ${code} before it answered`));
      },
    },
    done: () => {
      clearTimeout(timer);
      running.signal?.removeEventListener('abort', cancel);
    },
  };
}

function routed(current: () => ThreadEvents | undefined, troubled: () => void): ThreadEvents {
  return {
    answered: (message) => {
      const events = current();
      if (events === undefined) {
        troubled();
      } else {
        events.answered(message);
      }
    },
    failed: (error) => {
      const events = current();
      if (events === undefined) {
        troubled();
      } else {
        events.failed(error);
      }
    },
    exited: (code) => {
      current()?.exited(code);
    },
  };
}

function workerOptions(settings: PoolSettings): WorkerOptions {
  return {
    resourceLimits: { maxOldGenerationSizeMb: settings.heapMegabytes, stackSizeMb: workerStackMegabytes },
    env: { ...settings.environment },
  };
}

export function threadOf(module: string, settings: PoolSettings, hooks: ThreadHooks): Thread {
  const worker = new Worker(new URL(module), workerOptions(settings));
  const state: ThreadState = { jobs: 0 };
  const thread: Thread = {
    module,
    jobs: () => state.jobs,
    serve: async (job, work, running) => {
      state.jobs += 1;
      const watch = watchOf(job, work, running, hooks.closing);
      state.events = watch.events;
      worker.postMessage(work.envelope(job), []);
      const served = await watch.served;
      watch.done();
      delete state.events;
      return served;
    },
    rest: (idleMs, tired) => {
      worker.unref();
      state.resting = setTimeout(tired, idleMs);
      state.resting.unref();
    },
    wake: () => {
      clearTimeout(state.resting);
      worker.ref();
    },
    end: () => {
      clearTimeout(state.resting);
      state.ended ??= worker.terminate();
      return state.ended;
    },
  };
  const route = routed(
    () => state.events,
    () => {
      hooks.troubled(thread);
    },
  );
  worker
    .on('message', route.answered)
    .on('error', route.failed)
    .on('exit', (code: number) => {
      hooks.gone(thread);
      route.exited(code);
    });
  return thread;
}
