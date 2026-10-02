interface Waiter {
  readonly satisfied: () => boolean;
  readonly resolve: () => void;
}

interface Timer {
  readonly at: number;
  readonly order: number;
  readonly resolve: () => void;
}

export interface VirtualClock {
  readonly now: () => number;
  readonly timer: (milliseconds: number, resolve: () => void) => () => void;
  readonly waiter: (satisfied: () => boolean, resolve: () => void) => () => void;
  readonly advance: () => boolean;
}

export const workflowStartedAt = Date.parse('2026-10-01T09:00:00.000Z');

export function virtualClock(): VirtualClock {
  const waiters = new Set<Waiter>();
  const timers = new Set<Timer>();
  let clock = workflowStartedAt;
  let order = 0;

  function resolveSatisfied(): boolean {
    const satisfied = [...waiters].filter((waiter) => waiter.satisfied());
    for (const waiter of satisfied) {
      waiters.delete(waiter);
      waiter.resolve();
    }
    return satisfied.length > 0;
  }

  function fireNextTimer(): boolean {
    const [next] = [...timers].toSorted((left, right) =>
      left.at === right.at ? left.order - right.order : left.at - right.at,
    );
    if (next === undefined) {
      return false;
    }
    timers.delete(next);
    clock = next.at;
    next.resolve();
    return true;
  }

  return {
    now: () => clock,
    timer: (milliseconds, resolve) => {
      order += 1;
      const timer = { at: clock + Math.max(milliseconds, 1), order, resolve };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    waiter: (satisfied, resolve) => {
      const waiter = { satisfied, resolve };
      waiters.add(waiter);
      return () => {
        waiters.delete(waiter);
      };
    },
    advance: () => resolveSatisfied() || fireNextTimer(),
  };
}
