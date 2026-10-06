import type { FoldOutcome, ProgramPool } from '@beonauto/workflow-engine/dsl';

export interface FaultyPool {
  readonly pool: ProgramPool;
  readonly folds: () => number;
}

function firstFoldOf(pool: ProgramPool, first: () => Promise<FoldOutcome>): FaultyPool {
  const counted = { folds: 0 };
  return {
    pool: {
      ...pool,
      fold: (request, signal) => {
        counted.folds += 1;
        return counted.folds === 1 ? first() : pool.fold(request, signal);
      },
    },
    folds: () => counted.folds,
  };
}

export function failingOnce(pool: ProgramPool): FaultyPool {
  return firstFoldOf(pool, () => Promise.reject(new Error('The pool was told to fail')));
}

export function busyOnce(pool: ProgramPool): FaultyPool {
  return firstFoldOf(pool, () => Promise.resolve({ ran: 'stopped', because: 'busy', milliseconds: 0 }));
}

export function racingOnce(pool: ProgramPool, race: () => Promise<unknown>): ProgramPool {
  const raced = { done: false };
  return {
    ...pool,
    fold: async (request, signal) => {
      const outcome = await pool.fold(request, signal);
      if (!raced.done) {
        raced.done = true;
        await race();
      }
      return outcome;
    },
  };
}
