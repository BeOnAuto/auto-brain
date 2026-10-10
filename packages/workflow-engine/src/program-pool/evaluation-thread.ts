import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';

import { Schema } from 'effect';

import { hostClock } from '../instances/host-sandboxes.ts';
import { answeredFlag, ProgramRunSchema, readyFlag } from '../jobs/evaluation-messages.ts';
import type { PoolSettings } from '../jobs/pool-contract.ts';
import { remoteEvaluations, type EvaluationCalls, type Evaluations } from '../jobs/remote-evaluations.ts';
import { exhaustedBy, type ProgramRun } from '../programs/program-run.ts';
import { workerOptions } from './pool-threads.ts';

export const answerGraceMs = 50;

interface EvaluationThread extends EvaluationCalls {
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
  return { worker, port: port1, flags, ready, gone: () => state.gone };
}

function remainingUntil(at: number): number {
  return Math.max(0, at - performance.now());
}

function evaluationThreadOf(module: Readonly<URL>, settings: PoolSettings): EvaluationThread {
  const state: ThreadState = { closed: false };
  const current = (): Live | undefined => {
    if (!state.closed && (state.live === undefined || state.live.gone())) {
      state.live = started(module, settings);
    }
    return state.closed ? undefined : state.live;
  };
  const replaced = (): void => {
    void state.live?.worker.terminate();
    state.live = started(module, settings);
  };
  return {
    ready: async () => {
      await current()?.ready;
    },
    call: (request, waitMs) => {
      const live = current();
      const until = performance.now() + Math.max(0, waitMs);
      if (live === undefined || Atomics.wait(live.flags, readyFlag, 0, remainingUntil(until)) === 'timed-out') {
        return exhaustedBy('deadline', 0);
      }
      const remaining = remainingUntil(until);
      Atomics.store(live.flags, answeredFlag, 0);
      live.port.postMessage(
        { ...request, evaluation: { ...request.evaluation, deadlineAt: absoluteNow() + remaining } },
        [],
      );
      if (Atomics.wait(live.flags, answeredFlag, 0, remaining + answerGraceMs) === 'timed-out') {
        replaced();
        return exhaustedBy('deadline', 0);
      }
      const run: ProgramRun = decodeRun(receiveMessageOnPort(live.port)?.message);
      if (run.ran === 'exhausted' && run.limit === 'memory') {
        replaced();
      }
      return run;
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

export function poolEvaluationsOf(module: Readonly<URL>, settings: PoolSettings): PoolEvaluations {
  const thread = evaluationThreadOf(module, settings);
  return { evaluations: remoteEvaluations(thread, hostClock), close: thread.close };
}
