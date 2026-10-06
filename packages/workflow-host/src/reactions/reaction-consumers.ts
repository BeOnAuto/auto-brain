import type { RecordConsumer } from '../follower/consumers.ts';
import type { FollowerHost } from '../follower/follower-host.ts';
import { addressOfRun } from '../runs/run-address.ts';
import { listenerOffers } from './listener-offers.ts';
import type { ReactionOptions } from './reaction-options.ts';
import type { Refusals } from './refusals.ts';
import { workflowsOfRuns } from './run-workflows.ts';
import type { Starting } from './start-rates.ts';
import { subscriptionStarts } from './subscription-starts.ts';

export interface ReactionUse {
  readonly options: ReactionOptions;
  readonly refusals: Refusals;
}

export function reactionConsumersOf(
  host: FollowerHost,
  { options, refusals }: ReactionUse,
  starting: Starting,
): readonly RecordConsumer[] {
  const { database, clock, reports } = host;
  const offers = listenerOffers({
    database,
    refusals,
    offer: ({ runId, key, listener, event }) =>
      host.submitted({ kind: 'event_offered', executionId: runId, at: clock.now(), key, listener, event }),
    declined: (runId, detail) => reports.note({ kind: 'offer_declined', run: addressOfRun(runId), detail }),
    now: clock.now,
  });
  const starts = subscriptionStarts({
    database,
    starting,
    refusals,
    workflowOfRun: workflowsOfRuns((stream) => database.store.read(stream, 0), options.primitive),
    now: clock.now,
  });
  return [offers, starts];
}
