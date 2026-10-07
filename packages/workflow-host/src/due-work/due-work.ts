import { Effect } from 'effect';

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
}

export const dueInOneTick = 256;

export const duePerformedAtOnce = 16;

function itemPerformer(work: DueWork, waits: RowWaits, trouble: Trouble) {
  return (item: DueItem, now: number): Effect.Effect<void> =>
    item.perform(now).pipe(
      Effect.andThen(
        Effect.sync(() => {
          waits.performed(item.key);
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.andThen(
          Effect.sync(() => {
            waits.failed(item.key, now);
          }),
          trouble(`A due row of ${work.name} could not be performed; the loop tries it again after a wait`, cause),
        ),
      ),
    );
}

function workPerformer(work: DueWork, trouble: Trouble): DuePerformer {
  const waits = rowWaits();
  const backlog = { more: false };
  const performedItem = itemPerformer(work, waits, trouble);
  const performedReady = (items: readonly DueItem[], now: number): Effect.Effect<void> => {
    const ready = items.filter(({ key }) => !waits.holds(key, now));
    backlog.more = ready.length > dueInOneTick;
    return Effect.forEach(ready.slice(0, dueInOneTick), (item) => performedItem(item, now), {
      concurrency: duePerformedAtOnce,
      discard: true,
    });
  };
  return {
    performed: (now) =>
      work.due(now, dueInOneTick + 1 + waits.heldAt(now)).pipe(
        Effect.flatMap((items) => performedReady(items, now)),
        Effect.catchCause((cause) =>
          trouble(`The due rows of ${work.name} could not be read; the loop tries again`, cause),
        ),
      ),
    wakeAt: (now) =>
      backlog.more
        ? Effect.succeed(now)
        : work.nextDueAt(now).pipe(
            Effect.map((next) => Math.min(next ?? Number.POSITIVE_INFINITY, waits.nextUntil(now))),
            Effect.catchCause((cause) =>
              Effect.as(
                trouble(
                  `The next due time of ${work.name} could not be read; the loop waits for the next sweep`,
                  cause,
                ),
                Number.POSITIVE_INFINITY,
              ),
            ),
          ),
  };
}

export function duePerformer(works: readonly DueWork[], trouble: Trouble): DuePerformer {
  const performers = works.map((work) => workPerformer(work, trouble));
  return {
    performed: (now) => Effect.forEach(performers, ({ performed }) => performed(now), { discard: true }),
    wakeAt: (now) =>
      Effect.map(
        Effect.forEach(performers, ({ wakeAt }) => wakeAt(now)),
        (wakes: readonly number[]) => Math.min(Number.POSITIVE_INFINITY, ...wakes),
      ),
  };
}
