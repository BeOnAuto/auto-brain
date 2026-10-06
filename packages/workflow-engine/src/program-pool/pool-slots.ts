type Admission = 'admitted' | 'busy' | 'cancelled' | 'closing';

export interface PoolSlots {
  readonly admit: (until: number, signal?: Readonly<AbortSignal>) => Promise<Admission>;
  readonly release: () => void;
  readonly close: () => void;
}

type Waiter = (admission: Admission) => void;

interface Queue {
  readonly enter: (waiter: Waiter) => void;
  readonly leave: (waiter: Waiter) => void;
}

function waiting(queue: Queue, until: number, signal: Readonly<AbortSignal> | undefined): Promise<Admission> {
  const { promise, resolve } = Promise.withResolvers<Admission>();
  const timer = setTimeout(() => {
    waiter('busy');
  }, until - performance.now());
  const waiter: Waiter = (admission) => {
    queue.leave(waiter);
    clearTimeout(timer);
    resolve(admission);
  };
  signal?.addEventListener(
    'abort',
    () => {
      waiter('cancelled');
    },
    { once: true },
  );
  queue.enter(waiter);
  return promise;
}

export function poolSlots(size: number): PoolSlots {
  const state = { taken: 0, closing: false };
  const waiters = new Set<Waiter>();
  const queue: Queue = {
    enter: (waiter) => {
      waiters.add(waiter);
    },
    leave: (waiter) => {
      waiters.delete(waiter);
    },
  };
  return {
    admit: (until, signal) => {
      if (state.closing) {
        return Promise.resolve('closing');
      }
      if (state.taken < size) {
        state.taken += 1;
        return Promise.resolve('admitted');
      }
      return waiting(queue, until, signal);
    },
    release: () => {
      const [next] = waiters;
      if (next === undefined) {
        state.taken -= 1;
      } else {
        next('admitted');
      }
    },
    close: () => {
      state.closing = true;
      for (const waiter of waiters) {
        waiter('closing');
      }
    },
  };
}
