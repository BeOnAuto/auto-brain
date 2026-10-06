import type { Emitter, Listeners } from '@beonauto/workflow-engine';

import type { HostDatabase } from '../database/host-database.ts';
import { ledgerEmitter } from '../emissions/ledger-emitter.ts';
import { sqlListeners } from '../listeners/sql-listeners.ts';
import type { ReactionOptions } from './reaction-options.ts';
import { refusalsOn, type Refusals } from './refusals.ts';

export interface ReactionPorts {
  readonly listeners: Listeners;
  readonly emitter: Emitter;
  readonly refusals: Refusals;
}

export function reactionPortsOn(database: HostDatabase, options: ReactionOptions, now: () => number): ReactionPorts {
  const refusals = refusalsOn(database, now);
  return { listeners: sqlListeners(database, refusals), emitter: ledgerEmitter(options.emit, now), refusals };
}
