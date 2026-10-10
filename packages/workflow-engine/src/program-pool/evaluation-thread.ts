import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';

import { Function, Schema } from 'effect';

import { hostClock } from '../instances/host-sandboxes.ts';
import { answeredFlag, ProgramRunSchema, readyFlag, type AnsweredRequest } from '../jobs/evaluation-messages.ts';
import type { PoolSettings } from '../jobs/pool-contract.ts';
import {
  remoteEvaluations,
  type EvaluationAsks,
  type EvaluationCalls,
  type Evaluations,
} from '../jobs/remote-evaluations.ts';
import { exhaustedBy, type ProgramRun } from '../programs/program-run.ts';
import { workerOptions } from './pool-threads.ts';

export const answerGraceMs = 50;

interface Keeper {
  readonly current: () => Live | undefined;
  readonly replaced: () => void;
  readonly release: (unit: number) => void;
  readonly close: () => Promise<void>;
}

export interface PoolEvaluations {
  readonly evaluations: Evaluations;
  readonly close: () => Promise<void>;
}

interface Live {
  readonly worker: Worker;
  readonly port: MessagePort;
  readonly flags: Int32Array;
  readonly ready: Promise<void>;
  readonly gone: () => boolean;
  readonly post: (request: AnsweredRequest, waitMs: number) => void;
}

interface ThreadState {
  live?: Live;
  closed: boolean;
}

const decodeRun = Schema.decodeUnknownSync(ProgramRunSchema);

function absoluteNow(): number {
  return performance.timeOrigin + performance.now();
}

function started(module: Readonly<URL>, settings: PoolSettings): Live {
  const { port1, port2 } = new MessageChannel();
  const flags = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT));
  const worker = new Worker(module, {
    ...workerOptions(settings),
    workerData: { port: port2, flags: flags.buffer },
    transferList: [port2],
  });
  const state = { gone: false };
  const ended = Promise.withResolvers<void>();
  const end = (): void => {
    state.gone = true;
    ended.resolve();
  };
  worker.on('error', end).on('exit', end);
  const signalled = Promise.resolve(Atomics.waitAsync(flags, readyFlag, 0).value);
  const ready = (async (): Promise<void> => {
    await Promise.race([signalled, ended.promise]);
    worker.unref();
  })();
  const post = (request: AnsweredRequest, waitMs: number): void => {
    port1.postMessage({ ...request, evaluation: { ...request.evaluation, deadlineAt: absoluteNow() + waitMs } }, []);
  };
  return { worker, port: port1, flags, ready, gone: () => state.gone, post };
}

function remainingUntil(at: number): number {
  return Math.max(0, at - performance.now());
}

function keeperOf(module: Readonly<URL>, settings: PoolSettings): Keeper {
  const state: ThreadState = { closed: false };
  return {
    current: () => {
      if (!state.closed && (state.live === undefined || state.live.gone())) {
        state.live = started(module, settings);
      }
      return state.closed ? undefined : state.live;
    },
    replaced: () => {
      void state.live?.worker.terminate();
      state.live = started(module, settings);
    },
    release: (unit) => {
      state.live?.port.postMessage({ kind: 'close', unit }, []);
    },
    close: async () => {
      state.closed = true;
      await state.live?.worker.terminate();
    },
  };
}

function keptAfter(run: ProgramRun, keeper: Keeper): ProgramRun {
  if (run.ran === 'exhausted' && run.limit === 'memory') {
    keeper.replaced();
  }
  return run;
}

function callingThreadOf(keeper: Keeper): EvaluationCalls {
  return {
    ready: async () => {
      await keeper.current()?.ready;
    },
    call: (request, waitMs) => {
      const live = keeper.current();
      const until = performance.now() + Math.max(0, waitMs);
      if (live === undefined || Atomics.wait(live.flags, readyFlag, 0, remainingUntil(until)) === 'timed-out') {
        return exhaustedBy('deadline', 0);
      }
      const remaining = remainingUntil(until);
      Atomics.store(live.flags, answeredFlag, 0);
      live.post(request, remaining);
      if (Atomics.wait(live.flags, answeredFlag, 0, remaining + answerGraceMs) === 'timed-out') {
        keeper.replaced();
        return exhaustedBy('deadline', 0);
      }
      return keptAfter(decodeRun(receiveMessageOnPort(live.port)?.message), keeper);
    },
    release: keeper.release,
  };
}

function askingThreadOf(keeper: Keeper): EvaluationAsks {
  const queue: { last: Promise<unknown> } = { last: Promise.resolve() };
  const askedNow = async (request: AnsweredRequest, waitMs: number): Promise<ProgramRun> => {
    const live = keeper.current();
    if (live === undefined) {
      return exhaustedBy('deadline', 0);
    }
    await live.ready;
    const { promise, resolve } = Promise.withResolvers<ProgramRun>();
    const answered = (message: unknown): void => {
      clearTimeout(timer);
      resolve(keptAfter(decodeRun(message), keeper));
    };
    const timer = setTimeout(
      () => {
        live.port.off('message', answered);
        keeper.replaced();
        resolve(exhaustedBy('deadline', 0));
      },
      Math.max(0, waitMs) + answerGraceMs,
    );
    live.port.once('message', answered);
    live.port.unref();
    live.post(request, Math.max(0, waitMs));
    return promise;
  };
  return {
    ready: async () => {
      await keeper.current()?.ready;
    },
    ask: (request, waitMs) => {
      const asked = queue.last.then(() => askedNow(request, waitMs));
      queue.last = asked.then(Function.constVoid, Function.constVoid);
      return asked;
    },
    release: keeper.release,
  };
}

export function poolEvaluationsOf(module: Readonly<URL>, settings: PoolSettings): PoolEvaluations {
  const deciding = keeperOf(module, settings);
  const filtering = keeperOf(module, settings);
  return {
    evaluations: remoteEvaluations(callingThreadOf(deciding), askingThreadOf(filtering), hostClock),
    close: async () => {
      await Promise.all([deciding.close(), filtering.close()]);
    },
  };
}
