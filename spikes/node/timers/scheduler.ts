import type { Timer, TimerStore } from './timer-store.ts';

export type FiringMode = 'claim-then-fire' | 'fire-then-mark' | 'naive';

export interface SchedulerOptions {
  readonly store: TimerStore;
  readonly by: string;
  readonly mode: FiringMode;
  readonly fire: (timer: Timer, lateMs: number) => Promise<void> | void;
  readonly onError?: (error: unknown) => void;
}

export interface Scheduler {
  readonly schedule: (timer: Timer) => void;
  readonly cancel: (id: string) => void;
  readonly stop: () => void;
  readonly stats: () => {
    readonly wakes: number;
    readonly fired: number;
    readonly lostClaims: number;
    readonly errors: number;
  };
}

export function wallClock(): number {
  return performance.timeOrigin + performance.now();
}

export function startScheduler(options: SchedulerOptions): Scheduler {
  const { store, by, mode, fire } = options;
  let disarm: () => void = () => {};
  let armedFor: number | undefined;
  let firing = false;
  let stopped = false;
  const counts = { wakes: 0, fired: 0, lostClaims: 0, errors: 0 };

  const arm = (): void => {
    if (stopped) {
      return;
    }
    disarm();
    let earliest: number | undefined;
    try {
      earliest = store.earliest();
    } catch (error) {
      counts.errors += 1;
      options.onError?.(error);
      earliest = wallClock() + 50;
    }
    armedFor = earliest;
    if (earliest !== undefined) {
      const handle = setTimeout(wake, Math.max(0, Math.ceil(earliest - wallClock())));
      disarm = () => {
        clearTimeout(handle);
      };
    }
  };

  const fireOne = async (timer: Timer): Promise<void> => {
    const at = wallClock();
    if (mode === 'claim-then-fire' && !store.claim(timer.id, at, by)) {
      counts.lostClaims += 1;
      return;
    }
    await fire(timer, at - timer.fireAt);
    counts.fired += 1;
    if (mode !== 'claim-then-fire') {
      store.markFired(timer.id, at, by);
    }
  };

  const wake = async (): Promise<void> => {
    if (firing || stopped) {
      return;
    }
    firing = true;
    counts.wakes += 1;
    try {
      for (const timer of store.due(wallClock())) {
        await fireOne(timer);
      }
    } catch (error) {
      counts.errors += 1;
      options.onError?.(error);
    } finally {
      firing = false;
      arm();
    }
  };

  arm();
  return {
    schedule: (timer) => {
      store.arm(timer);
      if (armedFor === undefined || timer.fireAt < armedFor) {
        arm();
      }
    },
    cancel: (id) => {
      store.cancel(id);
    },
    stop: () => {
      stopped = true;
      disarm();
    },
    stats: () => ({ ...counts }),
  };
}
