import { Effect, Semaphore } from 'effect';

import { background } from '../calls/background.ts';
import type { Trouble } from '../calls/host-executor.ts';
import { rowWaits, type RowWaits } from './row-waits.ts';

export interface DueItem {
  readonly key: string;
  readonly perform: (now: number) => Effect.Effect<void, unknown>;
}

export interface DueWork {
  readonly name: string;
  readonly due: (now: number, most: number) => Effect.Effect<readonly DueItem[], unknown>;
  readonly nextDueAt: (after: number) => Effect.Effect<number | null, unknown>;
}

export interface DuePerformer {
  readonly performed: (now: number) => Effect.Effect<void>;
  readonly wakeAt: (now: number) => Effect.Effect<number>;
  readonly stop: () => Effect.Effect<void>;
}

export interface DueParts {
  readonly trouble: Trouble;
  readonly now: () => number;
  readonly wake: () => void;
}

export const dueInOneTick = 256;

export const duePerformedAtOnce = 16;

export const dueAwaitedMs = 1000;

function itemPerformer(work: DueWork, waits: RowWaits, { trouble, now }: DueParts) {
  return (item: DueItem): Effect.Effect<void> =>
    Effect.suspend(() => {
      const at = now();
      return item.perform(at).pipe(
        Effect.andThen(
          Effect.sync(() => {
            waits.performed(item.key);
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.andThen(
            Effect.sync(() => {
              waits.failed(item.key, at);
            }),
            trouble(`A due row of ${work.name} could not be performed; the loop tries it again after a wait`, cause),
          ),
        ),
      );
    });
}

function awaitedAtMost(handedOut: Effect.Effect<void>): Effect.Effect<void> {
  return Effect.interruptible(Effect.raceFirst(handedOut, Effect.sleep(dueAwaitedMs)));
}

function laterThan(now: number, next: number | null): number {
  return next === null || next <= now ? Number.POSITIVE_INFINITY : next;
}

function workPerformer(work: DueWork, parts: DueParts): DuePerformer {
  const waits = rowWaits();
  const running = background();
  const atOnce = Semaphore.makeUnsafe(duePerformedAtOnce);
  const backlog = { more: false };
  const performedItem = itemPerformer(work, waits, parts);
  const finished = Effect.sync(() => {
    parts.wake();
  });
  const handedOut = (items: readonly DueItem[], now: number): readonly string[] => {
    const ready = items.filter(({ key }) => !waits.holds(key, now) && !running.has(key));
    const given = ready.slice(0, Math.max(0, dueInOneTick - running.size()));
    backlog.more = ready.length > given.length;
    for (const item of given) {
      running.run(item.key, atOnce.withPermit(performedItem(item)).pipe(Effect.ensuring(finished)));
    }
    return given.map(({ key }) => key);
  };
  return {
    performed: (now) =>
      work.due(now, dueInOneTick + 1 + waits.heldAt(now) + running.size()).pipe(
        Effect.map((items) => handedOut(items, now)),
        Effect.flatMap((keys) => awaitedAtMost(running.awaited(keys))),
        Effect.catchCause((cause) =>
          parts.trouble(`The due rows of ${work.name} could not be read; the loop tries again`, cause),
        ),
      ),
    wakeAt: (now) =>
      backlog.more && running.size() < dueInOneTick
        ? Effect.succeed(now)
        : work.nextDueAt(now).pipe(
            Effect.map((next) => Math.min(laterThan(now, next), waits.nextUntil(now))),
            Effect.catchCause((cause) =>
              Effect.as(
                parts.trouble(
                  `The next due time of ${work.name} could not be read; the loop waits for the next sweep`,
                  cause,
                ),
                Number.POSITIVE_INFINITY,
              ),
            ),
          ),
    stop: running.stop,
  };
}

export function duePerformer(works: readonly DueWork[], parts: DueParts): DuePerformer {
  const performers = works.map((work) => workPerformer(work, parts));
  return {
    performed: (now) =>
      Effect.forEach(performers, ({ performed }) => performed(now), { concurrency: 'unbounded', discard: true }),
    wakeAt: (now) =>
      Effect.map(
        Effect.forEach(performers, ({ wakeAt }) => wakeAt(now)),
        (wakes: readonly number[]) => Math.min(Number.POSITIVE_INFINITY, ...wakes),
      ),
    stop: () => Effect.forEach(performers, ({ stop }) => stop(), { discard: true }),
  };
}
