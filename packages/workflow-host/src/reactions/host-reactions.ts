import { streamAppends } from '@beonauto/ledger';

import { brainRecordsOf } from '../follower/brain-records.ts';
import { followerOn, type FollowerAssembly } from '../follower/follower-assembly.ts';
import type { FollowerHost } from '../follower/follower-host.ts';
import type { Follower } from '../follower/follower-loop.ts';
import { systemClock } from '../loop/host-clock.ts';
import type { ReactionOptions } from './reaction-options.ts';
import type { ReactionPorts } from './reaction-ports.ts';

export interface FollowerConsumers {
  readonly consumers: FollowerAssembly['consumers'];
  readonly calls: FollowerAssembly['calls'];
}

export function startReacting(
  host: FollowerHost,
  options: ReactionOptions,
  { refusals, stops }: Pick<ReactionPorts, 'refusals' | 'stops'>,
  { consumers, calls }: FollowerConsumers,
): Follower {
  return followerOn(host, {
    options,
    refusals,
    stops,
    consumers,
    calls,
    records: brainRecordsOf(host.database.store),
    appended: options.appended ?? streamAppends,
    pace: systemClock,
  });
}
