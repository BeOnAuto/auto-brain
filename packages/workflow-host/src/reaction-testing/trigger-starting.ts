import { Effect, Function } from 'effect';

import { filterMatchingOf, filterStops, type FilterStops, type MatchFilters } from '../filtering/filter-matching.ts';
import type { ReactionStart } from '../reactions/reaction-options.ts';
import { subscriptionStarts } from '../reactions/subscription-starts.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { saidRefusals, type followedRecordOf } from './followed-records.ts';

const topRuns: ReadonlyMap<string, string> = new Map([
  ['r-of-close', 'close'],
  ['r-of-other', 'other'],
]);

interface CountingMatches {
  readonly match: MatchFilters;
  readonly stops: FilterStops;
  readonly evaluated: () => readonly string[];
}

export function countingMatches(): CountingMatches {
  const evaluated: string[] = [];
  const matching = filterMatchingOf();
  return {
    match: (filters, event, now) => {
      evaluated.push(...filters.map(({ reference }) => reference));
      return matching(filters, event, now);
    },
    stops: filterStops(),
    evaluated: () => evaluated,
  };
}

export async function starting() {
  const database = await openedOn(await onSQLite());
  const starts: ReactionStart[] = [];
  const { refusals, said } = saidRefusals();
  const { match, stops, evaluated } = countingMatches();
  const consumer = subscriptionStarts({
    database,
    starting: {
      start: (_brainKey, start) =>
        Effect.sync(() => {
          starts.push(start);
        }),
      startDeferred: Function.constant(Effect.succeed(0)),
    },
    refusals,
    workflowOfRun: (_brainKey, runId) => Effect.succeed(topRuns.get(runId)),
    match,
    stops,
    now: () => 0,
  });
  const delivered = (followed: ReturnType<typeof followedRecordOf>) =>
    Effect.runPromise(
      Effect.flatMap(consumer.batchOf(followed, undefined, 100), ({ deliveries }) =>
        Effect.forEach(deliveries, ({ deliver }) => deliver, { discard: true }),
      ),
    );
  const tried = (followed: ReturnType<typeof followedRecordOf>) =>
    Effect.runPromise(
      Effect.flatMap(consumer.batchOf(followed, undefined, 100), ({ deliveries }) =>
        Effect.forEach(deliveries, ({ workflow, deliver }) =>
          Effect.map(Effect.isSuccess(deliver), (made) => `${workflow} ${made ? 'delivered' : 'waits'}`),
        ),
      ),
    );
  return { database, consumer, delivered, tried, starts: () => starts, said, evaluated };
}
