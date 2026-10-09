import { Effect, Function } from 'effect';

import { filterMatchingOf } from '../reactions/filter-matching.ts';
import type { ReactionStart } from '../reactions/reaction-options.ts';
import { subscriptionStarts } from '../reactions/subscription-starts.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { saidRefusals, type followedRecordOf } from './followed-records.ts';

const topRuns: ReadonlyMap<string, string> = new Map([
  ['r-of-close', 'close'],
  ['r-of-other', 'other'],
]);

export async function starting() {
  const database = await openedOn(await onSQLite());
  const starts: ReactionStart[] = [];
  const { refusals, said } = saidRefusals();
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
    match: filterMatchingOf(),
    now: () => 0,
  });
  const delivered = (followed: ReturnType<typeof followedRecordOf>) =>
    Effect.runPromise(
      Effect.flatMap(consumer.batchOf(followed, undefined, 100), ({ deliveries }) =>
        Effect.forEach(deliveries, ({ deliver }) => deliver, { discard: true }),
      ),
    );
  return { database, consumer, delivered, starts: () => starts, said };
}
