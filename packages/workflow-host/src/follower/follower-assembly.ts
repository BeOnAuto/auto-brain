import { reactingOn } from '../reactions/reacting.ts';
import type { ReactionUse } from '../reactions/reaction-consumers.ts';
import { brainSweepsOn } from '../sweeps/brain-sweeps.ts';
import { brainDiscoveryOn } from './brain-discovery.ts';
import { passOf } from './brain-pass.ts';
import type { BrainRecords } from './brain-records.ts';
import { followedBrainsOn } from './followed-brains.ts';
import type { FollowerHost } from './follower-host.ts';
import { startFollower, type Follower, type FollowerParts } from './follower-loop.ts';
import { brainOfKey } from './record-steps.ts';

export interface FollowerAssembly extends ReactionUse {
  readonly records: BrainRecords;
  readonly appended: FollowerParts['appended'];
  readonly pace: FollowerParts['pace'];
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
      reports.note({ kind: 'record_unreadable', ...brainOfKey(brainKey), recordId: record.id, type: record.type }),
    passedEarly: (brainKey, { stream, version }, sweeps) =>
      reports.note({
        kind: 'run_record_passed',
        run: { ...brainOfKey(brainKey), executionId: stream.slice(stream.lastIndexOf('/') + 1) },
        version,
        sweeps,
      }),
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
    sweeps: brainSweepsOn(database.store, brains),
    upkeep: reacting.upkeep,
    appended: assembly.appended,
    clock,
    pace: assembly.pace,
    sweepEveryMs: host.sweepEveryMs,
    trouble: reports.trouble,
  });
}
