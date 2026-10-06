import type { AppendSignal } from '@beonauto/ledger';

import { reactingOn } from '../reactions/reacting.ts';
import type { ReactionUse } from '../reactions/reaction-consumers.ts';
import { brainDiscoveryOn } from './brain-discovery.ts';
import { passOf } from './brain-pass.ts';
import type { BrainRecords } from './brain-records.ts';
import { followedBrainsOn } from './followed-brains.ts';
import type { FollowerHost } from './follower-host.ts';
import { startFollower, type Follower } from './follower-loop.ts';

export interface FollowerAssembly extends ReactionUse {
  readonly records: BrainRecords;
  readonly appended: AppendSignal;
}

export function followerOn(host: FollowerHost, assembly: FollowerAssembly): Follower {
  const { database, clock, reports } = host;
  const brains = followedBrainsOn(database);
  const reacting = reactingOn(host, assembly);
  const pass = passOf({
    database,
    records: assembly.records,
    brains,
    consumers: reacting.consumers,
    primitive: assembly.options.primitive,
    applySpecRecord: reacting.applySpecRecord,
    unreadable: (brainKey, record) =>
      reports.note({ kind: 'record_unreadable', brainKey, recordId: record.id, type: record.type }),
  });
  const discovery = brainDiscoveryOn({
    database,
    brains,
    records: assembly.records,
    applySpecRecord: reacting.applySpecRecord,
    primitive: assembly.options.primitive,
  });
  return startFollower({
    pass,
    discovery,
    brains,
    upkeep: reacting.upkeep,
    appended: assembly.appended,
    clock,
    sweepEveryMs: host.sweepEveryMs,
    trouble: reports.trouble,
  });
}
