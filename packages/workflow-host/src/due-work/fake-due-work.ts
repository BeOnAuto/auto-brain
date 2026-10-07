import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';

import type { DueItem, DueWork } from './due-work.ts';

export interface PerformedRow {
  readonly key: string;
  readonly at: number;
  readonly by: string;
}

export interface FakeDueWork {
  readonly work: (by: string) => DueWork;
  readonly add: (key: string, dueAt: number) => void;
  readonly failing: (key: string) => void;
  readonly performed: () => readonly PerformedRow[];
  readonly attempts: () => readonly PerformedRow[];
  readonly mostAtOnce: () => number;
  readonly failReads: (times: number) => void;
}

interface RowStore {
  readonly add: (key: string, dueAt: number) => void;
  readonly done: (row: PerformedRow) => void;
  readonly dueBy: (now: number, most: number) => readonly string[];
  readonly nextAfter: (after: number) => number | null;
  readonly performed: () => readonly PerformedRow[];
}

interface Flight {
  readonly attempt: (row: PerformedRow, performMs: number) => Promise<boolean>;
  readonly failing: (key: string) => void;
  readonly attempts: () => readonly PerformedRow[];
  readonly most: () => number;
}

function rowStore(): RowStore {
  const rows = new Map<string, { readonly key: string; readonly dueAt: number }>();
  const performed: PerformedRow[] = [];
  const listed = () => [...rows.values()];
  return {
    add: (key, dueAt) => {
      rows.set(key, { key, dueAt });
    },
    done: (row) => {
      rows.delete(row.key);
      performed.push(row);
    },
    dueBy: (now, most) =>
      listed()
        .filter(({ dueAt }) => dueAt <= now)
        .toSorted((one, other) => one.dueAt - other.dueAt)
        .slice(0, most)
        .map(({ key }) => key),
    nextAfter: (after) => {
      const later = listed()
        .map(({ dueAt }) => dueAt)
        .filter((dueAt) => dueAt > after);
      return later.length === 0 ? null : Math.min(...later);
    },
    performed: () => performed,
  };
}

function flight(): Flight {
  const failing = new Set<string>();
  const attempts: PerformedRow[] = [];
  const counts = { now: 0, most: 0 };
  return {
    attempt: async (row, performMs) => {
      attempts.push(row);
      counts.now += 1;
      counts.most = Math.max(counts.most, counts.now);
      await setTimeout(performMs);
      counts.now -= 1;
      return failing.has(row.key);
    },
    failing: (key) => {
      failing.add(key);
    },
    attempts: () => attempts,
    most: () => counts.most,
  };
}

function itemOf(store: RowStore, flown: Flight, row: Omit<PerformedRow, 'at'>, performMs: number): DueItem {
  return {
    key: row.key,
    perform: (at) =>
      Effect.promise(() => flown.attempt({ ...row, at }, performMs)).pipe(
        Effect.flatMap((fails) =>
          fails
            ? Effect.fail(new Error(`The row ${row.key} cannot be performed`))
            : Effect.sync(() => {
                store.done({ ...row, at });
              }),
        ),
      ),
  };
}

export function fakeDueWork(performMs = 0): FakeDueWork {
  const store = rowStore();
  const flown = flight();
  const reads = { failing: 0 };
  const read = <A>(answer: () => A): Effect.Effect<A, Error> =>
    Effect.suspend(() => {
      reads.failing -= 1;
      return reads.failing < 0 ? Effect.sync(answer) : Effect.fail(new Error('The rows are out of reach'));
    });
  return {
    work: (by) => ({
      name: 'the fake rows',
      due: (now, most) => read(() => store.dueBy(now, most).map((key) => itemOf(store, flown, { key, by }, performMs))),
      nextDueAt: (after) => read(() => store.nextAfter(after)),
    }),
    add: store.add,
    failing: flown.failing,
    performed: store.performed,
    attempts: flown.attempts,
    mostAtOnce: flown.most,
    failReads: (times) => {
      reads.failing = times;
    },
  };
}
