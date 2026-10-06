import { specChangeOf } from '@beonauto/specs';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { Trigger } from './reaction-options.ts';
import { activated, deactivated } from './subscriptions.ts';

export type ApplySpecRecord = (brainKey: string, data: unknown) => Effect.Effect<void>;

export function specRecordsOn(
  database: HostDatabase,
  triggerOf: (source: string) => Trigger | undefined,
): ApplySpecRecord {
  return (brainKey, data) => {
    const change = specChangeOf(data);
    if (change.kind === 'activated') {
      const trigger = triggerOf(change.source);
      return trigger === undefined
        ? deactivated(database, brainKey, change.name)
        : activated(database, brainKey, change, trigger);
    }
    return change.kind === 'deactivated' ? deactivated(database, brainKey, change.name) : Effect.void;
  };
}
