import { Effect, Function } from 'effect';

import type { SandboxInstance } from './sandbox-session.ts';

export interface MachineSandbox {
  readonly reserve: Effect.Effect<void>;
  readonly take: () => SandboxInstance;
  readonly release: () => void;
  readonly clock: () => number;
}

interface Stock {
  readonly setAside: () => boolean;
  readonly waitFor: () => Promise<void>;
  readonly taken: () => SandboxInstance | undefined;
  readonly released: () => void;
}

const spareInstances = 1;

function stockOf(prepare: () => Promise<SandboxInstance>): Stock {
  const ready: SandboxInstance[] = [];
  const waiters: (() => void)[] = [];
  const counts = { setAside: 0, preparing: 0 };
  const serve = (): void => {
    const served = Math.max(0, Math.min(waiters.length, ready.length - counts.setAside));
    counts.setAside += served;
    for (const waiter of waiters.splice(0, served)) {
      waiter();
    }
  };
  const refill = (): void => {
    while (ready.length + counts.preparing < counts.setAside + waiters.length + spareInstances) {
      counts.preparing += 1;
      void prepare().then((instance) => {
        counts.preparing -= 1;
        ready.push(instance);
        serve();
        refill();
        return instance;
      });
    }
  };
  refill();
  return {
    setAside: () => {
      const free = ready.length > counts.setAside;
      counts.setAside += free ? 1 : 0;
      refill();
      return free;
    },
    waitFor: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
        refill();
      }),
    taken: () => {
      counts.setAside = Math.max(0, counts.setAside - 1);
      const instance = ready.pop();
      refill();
      return instance;
    },
    released: () => {
      counts.setAside = Math.max(0, counts.setAside - 1);
    },
  };
}

export function reservedSandbox(prepare: () => Promise<SandboxInstance>, clock: () => number): MachineSandbox {
  const stock = stockOf(prepare);
  return {
    reserve: Effect.suspend(() => (stock.setAside() ? Effect.void : Effect.promise(stock.waitFor))),
    take: () => {
      const instance = stock.taken();
      if (instance === undefined) {
        throw new Error('A decision took a sandbox no input had set aside');
      }
      return instance;
    },
    release: stock.released,
    clock,
  };
}

export function reusedSandbox(instance: SandboxInstance, clock: () => number): MachineSandbox {
  return { reserve: Effect.void, take: () => instance, release: Function.constVoid, clock };
}
