import { describeError, type DslError, type FilterVerdict } from '@beonauto/workflow-engine';
import { Array, Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { deliverySweeps, type RecordConsumer, type Delivery, type FollowedRecord } from '../follower/consumers.ts';
import { eventSubscriptionsOf, type EventSubscription } from '../triggers/trigger-rows.ts';
import { groupMatchingOf, type MatchFilters, type MatchGroups } from './filter-matching.ts';
import { reactionRunIdOf } from './reaction-ids.ts';
import type { RefuseReaction } from './refusals.ts';
import type { WorkflowOfRun } from './run-workflows.ts';
import type { Starting } from './start-rates.ts';

export const mostReactionDepth = 8;

export interface StartParts {
  readonly database: HostDatabase;
  readonly starting: Starting;
  readonly refusals: RefuseReaction;
  readonly workflowOfRun: WorkflowOfRun;
  readonly match: MatchFilters;
  readonly now: () => number;
}

type Verdict = 'matched' | 'unmatched' | { readonly error: string };

interface SubscriptionVerdict {
  readonly subscription: EventSubscription;
  readonly verdict: Verdict;
  readonly stopped: readonly DslError[];
}

function verdictOf(verdicts: readonly FilterVerdict[]): Verdict {
  if (verdicts.includes(true)) {
    return 'matched';
  }
  const failed = verdicts.find((verdict) => typeof verdict === 'object' && !verdict.stopped);
  return typeof failed === 'object' ? { error: describeError(failed.error) } : 'unmatched';
}

function scopeOf(brainKey: string, { workflow, reference, version }: EventSubscription): string {
  return JSON.stringify([brainKey, workflow, reference, version]);
}

function verdictsOf(
  matchGroups: MatchGroups,
  parts: StartParts,
  subscriptions: readonly EventSubscription[],
  { brainKey, event: { event } }: FollowedRecord,
): Effect.Effect<readonly SubscriptionVerdict[]> {
  const groups = subscriptions.map((subscription) => ({
    scope: scopeOf(brainKey, subscription),
    filters: subscription.filters,
  }));
  return Effect.map(matchGroups(groups, event, parts.now()), (matched) =>
    Array.zipWith(subscriptions, matched, (subscription, { verdicts, stopped }): SubscriptionVerdict => ({
      subscription,
      verdict: verdictOf(verdicts),
      stopped,
    })),
  );
}

function isOwn(parts: StartParts, workflow: string, { brainKey, event }: FollowedRecord): Effect.Effect<boolean> {
  if (event.ownedBy.includes(workflow)) {
    return Effect.succeed(true);
  }
  return event.topRun === undefined
    ? Effect.succeed(false)
    : Effect.map(parts.workflowOfRun(brainKey, event.topRun), (owner) => owner === workflow);
}

function startOf(parts: StartParts, subscription: EventSubscription, followed: FollowedRecord): Delivery {
  const { brain, brainKey, record, event } = followed;
  const { workflow, version, reference } = subscription;
  return {
    key: workflow,
    workflow,
    deliver:
      event.depth > mostReactionDepth
        ? parts.refusals.refuse(
            brainKey,
            workflow,
            `An event matched the event trigger of the workflow at reaction depth ${event.depth}, past the ${mostReactionDepth} a chain of reactions may reach`,
          )
        : parts.starting.start(brainKey, {
            ...brain,
            workflow,
            version,
            runId: reactionRunIdOf(workflow, version, reference, record.id),
            input: [event.event],
            depth: event.depth,
            cause: record.id,
            trigger: { kind: 'event', reference },
          }),
  };
}

function reportedStops(parts: StartParts, brainKey: string, workflow: string, stopped: readonly DslError[]) {
  return Effect.forEach(
    stopped,
    (error) =>
      parts.refusals.refuse(
        brainKey,
        workflow,
        `The filter of the workflow's event trigger went past a bound on an event, so it did not match, and it is not evaluated again for this version of the workflow; a new version evaluates it again: ${describeError(error)}`,
      ),
    { discard: true },
  );
}

export function subscriptionStarts(parts: StartParts): RecordConsumer {
  const matchGroups = groupMatchingOf(parts.match);
  const reported = new Set<string>();
  const reportedOnce = (brainKey: string, { subscription, verdict, stopped }: SubscriptionVerdict) => {
    const key = scopeOf(brainKey, subscription);
    const fresh = typeof verdict === 'object' && !reported.has(key);
    if (fresh) {
      reported.add(key);
    }
    return Effect.andThen(
      reportedStops(parts, brainKey, subscription.workflow, stopped),
      fresh
        ? parts.refusals.refuse(
            brainKey,
            subscription.workflow,
            `The filter of the workflow's event trigger failed on an event, so it did not match: ${verdict.error}`,
          )
        : Effect.void,
    );
  };
  return {
    name: 'subscription_starts',
    skippedAfterSweeps: deliverySweeps,
    batchOf: (followed, after, most) =>
      Effect.gen(function* () {
        const type = followed.event.event.type;
        const candidates = yield* eventSubscriptionsOf(parts.database, followed.brainKey, { type, after, most });
        const taken = candidates.slice(0, most);
        const judged = yield* verdictsOf(matchGroups, parts, taken, followed);
        yield* Effect.forEach(judged, (each) => reportedOnce(followed.brainKey, each), { discard: true });
        const matched = judged.flatMap(({ subscription, verdict }) => (verdict === 'matched' ? [subscription] : []));
        const owned = yield* Effect.forEach(matched, (subscription) => isOwn(parts, subscription.workflow, followed));
        return {
          deliveries: matched
            .filter((_, index) => owned[index] !== true)
            .map((subscription) => startOf(parts, subscription, followed)),
          through: taken.at(-1)?.workflow,
          more: candidates.length > most,
        };
      }),
    skipped: ({ brainKey }, { workflow }, detail) =>
      parts.refusals.refuse(brainKey, workflow, `The workflow could not be started by its event trigger: ${detail}`),
  };
}
