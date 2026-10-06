import { Effect } from 'effect';

import type { Consumer } from '../follower/consumers.ts';
import type { FollowerHost } from '../follower/follower-host.ts';
import type { Upkeep } from '../follower/follower-loop.ts';
import { scheduleFiringOn } from '../schedules/schedule-firing.ts';
import { reactionConsumersOf, type ReactionUse } from './reaction-consumers.ts';
import { specRecordsOn, type ApplySpecRecord } from './spec-records.ts';
import { startingOn } from './start-rates.ts';

export interface Reacting {
  readonly consumers: readonly Consumer[];
  readonly applySpecRecord: ApplySpecRecord;
  readonly upkeep: Upkeep;
}

export function reactingOn(host: FollowerHost, use: ReactionUse): Reacting {
  const { database, clock } = host;
  const { options, refusals } = use;
  const starting = startingOn(database, options.start, refusals, clock.now);
  const schedules = scheduleFiringOn(database, options.start, refusals, clock.now);
  return {
    consumers: reactionConsumersOf(host, use, starting),
    applySpecRecord: specRecordsOn(database, options.triggerOf),
    upkeep: {
      sweep: () => Effect.asVoid(Effect.andThen(starting.startDeferred(), refusals.flush())),
      fireSchedules: () => Effect.asVoid(schedules.fireDue()),
      nextScheduleAt: schedules.nextDueAt,
    },
  };
}
