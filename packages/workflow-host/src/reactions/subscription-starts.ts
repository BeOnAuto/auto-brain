import { describeError, matchEvent } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { deliverySweeps, type RecordConsumer, type Delivery, type FollowedRecord } from '../follower/consumers.ts';
import { eventSubscriptionsOf, type EventSubscription } from '../triggers/trigger-rows.ts';
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
  readonly now: () => number;
}

type Verdict = 'matched' | 'unmatched' | { readonly error: string };

function verdictOf({ filters }: EventSubscription, { event: { event } }: FollowedRecord, now: number): Verdict {
  const verdicts = filters.map((filter) => matchEvent(filter, event, now));
  if (verdicts.includes(true)) {
    return 'matched';
  }
  const failed = verdicts.find((verdict) => typeof verdict === 'object');
  return typeof failed === 'object' ? { error: describeError(failed.error) } : 'unmatched';
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

export function subscriptionStarts(parts: StartParts): RecordConsumer {
  const reported = new Set<string>();
  const reportedOnce = (brainKey: string, { workflow, version, reference }: EventSubscription, error: string) => {
    const key = JSON.stringify([brainKey, workflow, reference, version]);
    const fresh = !reported.has(key);
    reported.add(key);
    return fresh
      ? parts.refusals.refuse(
          brainKey,
          workflow,
          `The filter of the workflow's event trigger failed on an event, so it did not match: ${error}`,
        )
      : Effect.void;
  };
  return {
    name: 'subscription_starts',
    skippedAfterSweeps: deliverySweeps,
    batchOf: (followed, after, most) =>
      Effect.gen(function* () {
        const now = parts.now();
        const type = followed.event.event.type;
        const candidates = yield* eventSubscriptionsOf(parts.database, followed.brainKey, { type, after, most });
        const taken = candidates.slice(0, most);
        const verdicts = taken.map((subscription) => verdictOf(subscription, followed, now));
        yield* Effect.forEach(
          taken,
          (subscription, index) => {
            const verdict = verdicts[index];
            return typeof verdict === 'object'
              ? reportedOnce(followed.brainKey, subscription, verdict.error)
              : Effect.void;
          },
          { discard: true },
        );
        const matched = taken.filter((_, index) => verdicts[index] === 'matched');
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
