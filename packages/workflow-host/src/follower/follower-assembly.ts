import { reactingOn } from '../reactions/reacting.ts';
import type { ReactionUse } from '../reactions/reaction-consumers.ts';
import { brainSweepsOn } from '../sweeps/brain-sweeps.ts';
import { brainDiscoveryOn } from './brain-discovery.ts';
import { passOf, type PassParts } from './brain-pass.ts';
import type { BrainRecords } from './brain-records.ts';
import { followedBrainsOn } from './followed-brains.ts';
import type { FollowerHost } from './follower-host.ts';
import { startFollower, type Follower, type FollowerParts } from './follower-loop.ts';
import { brainOfKey, type StepParts } from './record-steps.ts';

export interface FollowerAssembly extends ReactionUse {
  readonly records: BrainRecords;
  readonly appended: FollowerParts['appended'];
  readonly pace: FollowerParts['pace'];
  readonly consumers: PassParts['registered'];
  readonly calls: PassParts['calls'];
}

export function followerOn(host: FollowerHost, assembly: FollowerAssembly): Follower {
  const { database, clock, reports } = host;
  const brains = followedBrainsOn(database);
  const reacting = reactingOn(host, assembly);
  const unreadable: StepParts['unreadable'] = (brainKey, { id, type }) =>
    reports.note({ kind: 'record_unreadable', ...brainOfKey(brainKey), recordId: id, type });
  const pass = passOf({
    database,
    records: assembly.records,
    brains,
    consumers: reacting.consumers,
    registered: assembly.consumers,
    calls: assembly.calls,
    type: assembly.options.type,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    unreadable,
    passedEarly: (brainKey, { stream, version }, sweeps) =>
      reports.note({
        kind: 'run_record_passed',
        run: { ...brainOfKey(brainKey), runId: stream.slice(stream.lastIndexOf('/') + 1) },
        version,
        sweeps,
      }),
  });
  const discovery = brainDiscoveryOn({
    database,
    brains,
    records: assembly.records,
    applyDefinitionRecord: reacting.applyDefinitionRecord,
    unreadable,
    type: assembly.options.type,
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
