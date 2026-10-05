import type { RunSerialiser } from '@beonauto/workflow-engine';
import { Effect, Semaphore } from 'effect';

interface RunLock {
  readonly semaphore: Semaphore.Semaphore;
  readonly release: () => void;
}

export function runSerialiser(): RunSerialiser {
  const locks = new Map<string, { readonly semaphore: Semaphore.Semaphore; holders: number }>();
  const lockOf = (runId: string): RunLock => {
    const lock = locks.get(runId) ?? { semaphore: Semaphore.makeUnsafe(1), holders: 0 };
    lock.holders += 1;
    locks.set(runId, lock);
    return {
      semaphore: lock.semaphore,
      release: () => {
        lock.holders -= 1;
        if (lock.holders === 0) {
          locks.delete(runId);
        }
      },
    };
  };
  return {
    serialise: (runId, work) =>
      Effect.suspend(() => {
        const { semaphore, release } = lockOf(runId);
        return semaphore.withPermit(work).pipe(Effect.ensuring(Effect.sync(release)));
      }),
  };
}
