import { stopped } from '../jobs/job-endings.ts';
import type { PoolSettings } from '../jobs/pool-contract.ts';
import type { Evaluate } from './pool-job.ts';
import { threadOf, type Thread, type ThreadHooks } from './pool-threads.ts';

export const idleWorkerMs = 60_000;

export const jobsBeforeRecycling = 1000;

export interface PoolWorkers {
  readonly evaluate: Evaluate;
  readonly close: () => Promise<void>;
}

interface Shelf {
  readonly forget: (thread: Thread) => void;
  readonly hold: (thread: Thread) => void;
  readonly rest: (thread: Thread) => void;
  readonly warm: (module: string) => Thread | undefined;
  readonly oldest: () => readonly Thread[];
  readonly all: () => readonly Thread[];
}

interface Fleet {
  readonly start: (module: string) => Promise<Thread | undefined>;
  readonly letGo: (thread: Thread) => Promise<number>;
  readonly ended: () => Promise<unknown>;
}

interface Seats {
  readonly free: () => boolean;
  readonly oldest: () => readonly Thread[];
  readonly letGo: (thread: Thread) => Promise<number>;
  readonly someEnded: () => Promise<number>;
}

interface Roster {
  readonly take: (module: string) => Promise<Thread | undefined>;
  readonly rest: (thread: Thread) => void;
  readonly letGo: (thread: Thread) => Promise<number>;
  readonly closing: () => boolean;
  readonly close: () => Promise<void>;
}

async function roomIn(seats: Seats): Promise<void> {
  if (seats.free()) {
    return;
  }
  for (const oldest of seats.oldest()) {
    void seats.letGo(oldest);
  }
  await seats.someEnded();
  await roomIn(seats);
}

function shelfOf(): Shelf {
  const idle: Thread[] = [];
  const busy = new Set<Thread>();
  const forget = (thread: Thread): void => {
    const at = idle.indexOf(thread);
    if (at !== -1) {
      idle.splice(at, 1);
    }
    busy.delete(thread);
  };
  return {
    forget,
    hold: (thread) => {
      forget(thread);
      busy.add(thread);
    },
    rest: (thread) => {
      forget(thread);
      idle.push(thread);
    },
    warm: (module) => idle.findLast((each) => each.module === module),
    oldest: () => idle.slice(0, 1),
    all: () => [...idle, ...busy],
  };
}

function fleetOf(settings: PoolSettings, shelf: Shelf, closing: () => boolean): Fleet {
  const dying = new Set<Promise<number>>();
  const count = { alive: 0, starting: 0 };
  const letGo = (thread: Thread): Promise<number> => {
    shelf.forget(thread);
    const ended = thread.end();
    dying.add(ended);
    void ended.then(() => dying.delete(ended));
    return ended;
  };
  const hooks: ThreadHooks = {
    closing,
    troubled: (thread) => {
      void letGo(thread);
    },
    gone: (thread) => {
      shelf.forget(thread);
      count.alive -= 1;
    },
  };
  const seats: Seats = {
    free: () => closing() || count.alive + count.starting <= settings.workers,
    oldest: shelf.oldest,
    letGo,
    someEnded: () => Promise.race(dying),
  };
  const started = (module: string): Thread => {
    const thread = threadOf(module, settings, hooks);
    count.alive += 1;
    return thread;
  };
  return {
    start: async (module) => {
      count.starting += 1;
      await roomIn(seats);
      count.starting -= 1;
      return closing() ? undefined : started(module);
    },
    letGo,
    ended: () => Promise.all(dying),
  };
}

function rosterOf(settings: PoolSettings, idleMs: number): Roster {
  const shelf = shelfOf();
  const state = { closing: false };
  const fleet = fleetOf(settings, shelf, () => state.closing);
  return {
    take: async (module) => {
      const warm = shelf.warm(module);
      warm?.wake();
      const thread = warm ?? (await fleet.start(module));
      if (thread !== undefined) {
        shelf.hold(thread);
      }
      return thread;
    },
    rest: (thread) => {
      shelf.rest(thread);
      thread.rest(idleMs, () => {
        void fleet.letGo(thread);
      });
    },
    letGo: fleet.letGo,
    closing: () => state.closing,
    close: async () => {
      state.closing = true;
      await Promise.all(shelf.all().map((thread) => fleet.letGo(thread)));
      await fleet.ended();
    },
  };
}

export function poolWorkers(settings: PoolSettings): PoolWorkers {
  const jobsPerWorker = settings.jobsPerWorker ?? jobsBeforeRecycling;
  const roster = rosterOf(settings, settings.idleMs ?? idleWorkerMs);
  const jobs = { last: 0 };
  return {
    evaluate: async (work, running) => {
      const thread = await roster.take(work.module.href);
      if (thread === undefined) {
        return stopped('closing');
      }
      jobs.last += 1;
      const { ending, keep } = await thread.serve(jobs.last, work, running);
      if (keep && !roster.closing() && thread.jobs() < jobsPerWorker) {
        roster.rest(thread);
      } else {
        await roster.letGo(thread);
      }
      return ending;
    },
    close: roster.close,
  };
}
