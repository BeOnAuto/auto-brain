import { streamAppends } from '@beonauto/ledger';

import { brainRecordsOf } from '../follower/brain-records.ts';
import { followerOn } from '../follower/follower-assembly.ts';
import type { FollowerHost } from '../follower/follower-host.ts';
import type { Follower } from '../follower/follower-loop.ts';
import type { ReactionOptions } from './reaction-options.ts';
import type { Refusals } from './refusals.ts';

export function startReacting(host: FollowerHost, options: ReactionOptions, refusals: Refusals): Follower {
  return followerOn(host, {
    options,
    refusals,
    records: brainRecordsOf(host.database.store),
    appended: options.appended ?? streamAppends,
  });
}
