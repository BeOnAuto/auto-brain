import type { FoldOutcome, ProgramPool } from '@beonauto/workflow-engine/dsl';

import type { HostDatabase } from '../database/host-database.ts';

export interface FaultyPool {
  readonly pool: ProgramPool;
  readonly folds: () => number;
}

export interface Held<Gated> {
  readonly gated: Gated;
  readonly waiting: () => number;
  readonly most: () => number;
  readonly total: () => number;
  readonly open: () => void;
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

export function secondFoldWithBudget(pool: ProgramPool, pageBudgetMs: number): ProgramPool {
  const counted = { folds: 0 };
  return {
    ...pool,
    fold: (request, signal) => {
      counted.folds += 1;
      return pool.fold(counted.folds === 2 ? { ...request, pageBudgetMs } : request, signal);
    },
  };
}

function held<Gated>(gate: (wait: () => Promise<void>) => Gated): Held<Gated> {
  const opened = Promise.withResolvers<void>();
  const counts = { waiting: 0, most: 0, total: 0 };
  const wait = async (): Promise<void> => {
    counts.total += 1;
    counts.waiting += 1;
    counts.most = Math.max(counts.most, counts.waiting);
    await opened.promise;
    counts.waiting -= 1;
  };
  return {
    gated: gate(wait),
    waiting: () => counts.waiting,
    most: () => counts.most,
    total: () => counts.total,
    open: () => {
      opened.resolve();
    },
  };
}

export function heldReads(database: HostDatabase): Held<HostDatabase> {
  return held((wait) => ({
    ...database,
    store: {
      ...database.store,
      readRecorded: async (brainKey, selection, page) => {
        await wait();
        return database.store.readRecorded(brainKey, selection, page);
      },
    },
  }));
}

export function heldFolds(pool: ProgramPool): Held<ProgramPool> {
  return held((wait) => ({
    ...pool,
    fold: async (request, signal) => {
      await wait();
      return pool.fold(request, signal);
    },
  }));
}
