export interface Clock {
  readonly now: () => number;
  readonly after: (milliseconds: number, work: () => Promise<void>) => () => void;
}

interface Scheduled {
  readonly at: number;
  readonly order: number;
  readonly group: string;
  readonly work: () => Promise<void>;
}

export interface VirtualClock {
  readonly groupClock: (group: string) => Clock;
  readonly drop: (group: string) => number;
  readonly now: () => number;
  readonly next: () => number | undefined;
  readonly runNext: () => Promise<void>;
  readonly setNow: (at: number) => void;
}

export const minute = 60_000;

export function virtualClock(startedAt: number): VirtualClock {
  let now = startedAt;
  let order = 0;
  const queue = new Set<Scheduled>();
  const earliest = (): Scheduled | undefined =>
    [...queue].toSorted((left, right) => (left.at === right.at ? left.order - right.order : left.at - right.at))[0];
  return {
    groupClock: (group) => ({
      now: () => now,
      after: (milliseconds, work) => {
        order += 1;
        const scheduled = { at: now + milliseconds, order, group, work };
        queue.add(scheduled);
        return () => {
          queue.delete(scheduled);
        };
      },
    }),
    drop: (group) => {
      const dropped = [...queue].filter((scheduled) => scheduled.group === group);
      for (const scheduled of dropped) {
        queue.delete(scheduled);
      }
      return dropped.length;
    },
    now: () => now,
    next: () => earliest()?.at,
    runNext: async () => {
      const scheduled = earliest();
      if (scheduled !== undefined) {
        queue.delete(scheduled);
        now = Math.max(now, scheduled.at);
        await scheduled.work();
      }
    },
    setNow: (at) => {
      now = Math.max(now, at);
    },
  };
}

export function realClock(): Clock {
  return {
    now: () => Date.now(),
    after: (milliseconds, work) => {
      const handle = setTimeout(() => {
        void work();
      }, milliseconds);
      return () => {
        clearTimeout(handle);
      };
    },
  };
}
