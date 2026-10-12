import { Option } from 'effect';

import type { Ending, Stopped } from '../jobs/job-endings.ts';
import type { Job } from '../jobs/pool-job.ts';
import { admitted, poolSlots } from '../program-pool/pool-slots.ts';
import { poolWorkers, type RosterSettings } from '../program-pool/pool-workers.ts';
import { commandOf, limiterOn } from './memory-limit.ts';
import type { ProcessMessage } from './process-messages.ts';
import { processThreadOf } from './process-thread.ts';
import { valueOf, wireOf, type ProcessValue } from './process-values.ts';

export interface ProcessPoolSettings {
  readonly processes: number;
  readonly longJobs: number;
  readonly memoryBytes: number;
  readonly path?: string;
  readonly idleMs?: number;
  readonly jobsPerProcess?: number;
}

export interface ProcessRequest {
  readonly module: Readonly<URL>;
  readonly key: string;
  readonly kind: string;
  readonly payload: ProcessValue;
  readonly deadlineMs: number;
  readonly long?: boolean;
}

type StoppedEnding = 'timed_out' | 'out_of_memory' | 'busy' | 'cancelled' | 'closing';

export type ProcessEnding =
  | { readonly ended: 'answered'; readonly answer: ProcessValue }
  | { readonly ended: 'crashed'; readonly detail: string }
  | { readonly ended: StoppedEnding };

export type ProcessOutcome = ProcessEnding & { readonly milliseconds: number };

export interface ProcessPool {
  readonly processes: number;
  readonly longJobs: number;
  readonly memoryBytes: number;
  readonly limiter: string | undefined;
  readonly run: (request: ProcessRequest, signal?: Readonly<AbortSignal>) => Promise<ProcessOutcome>;
  readonly close: () => Promise<void>;
}

interface Answered {
  readonly ran: 'answered';
  readonly answer: ProcessValue;
}

const stoppedAs: Readonly<Record<Stopped, StoppedEnding>> = {
  deadline: 'timed_out',
  memory: 'out_of_memory',
  busy: 'busy',
  cancelled: 'cancelled',
  closing: 'closing',
};

function answeredOf(answer: unknown): Option.Option<Answered> {
  const value = valueOf(answer);
  return value === undefined ? Option.none() : Option.some({ ran: 'answered', answer: value });
}

function jobOf(request: ProcessRequest): Job<Answered, ProcessMessage> {
  const payload = wireOf(request.payload);
  return {
    key: JSON.stringify([request.module.href, request.key]),
    module: request.module,
    envelope: (job) => ({ job, kind: request.kind, payload }),
    decode: answeredOf,
  };
}

function endingOf(ending: Ending<Answered>): ProcessEnding {
  if (ending.ran === 'answered') {
    return { ended: 'answered', answer: ending.answer };
  }
  return ending.ran === 'crashed' ? { ended: 'crashed', detail: ending.detail } : { ended: stoppedAs[ending.because] };
}

function rosterOf({ processes, idleMs, jobsPerProcess }: ProcessPoolSettings): RosterSettings {
  return {
    workers: processes,
    ...(idleMs === undefined ? {} : { idleMs }),
    ...(jobsPerProcess === undefined ? {} : { jobsPerWorker: jobsPerProcess }),
  };
}

export function processPool(settings: ProcessPoolSettings): ProcessPool {
  const limiter = limiterOn(settings.path ?? process.env['PATH']);
  const command = commandOf(limiter, settings.memoryBytes);
  const slots = poolSlots(settings.processes);
  const longSlots = poolSlots(settings.longJobs);
  const processes = poolWorkers<ProcessMessage>(rosterOf(settings), (start, hooks) =>
    processThreadOf(start, command, hooks),
  );
  return {
    processes: settings.processes,
    longJobs: settings.longJobs,
    memoryBytes: settings.memoryBytes,
    limiter,
    run: async (request, signal) => {
      const started = performance.now();
      const until = started + request.deadlineMs;
      const job = jobOf(request);
      const served = (): Promise<Ending<Answered>> =>
        admitted(slots, until, signal, () => processes.evaluate(job, { until, signal }));
      const ending = await (request.long === true ? admitted(longSlots, until, signal, served) : served());
      return { ...endingOf(ending), milliseconds: performance.now() - started };
    },
    close: async () => {
      slots.close();
      longSlots.close();
      await processes.close();
    },
  };
}
