import type { Ledger } from '@beonauto/operations';
import type { Layer } from 'effect';
import { onTestFinished } from 'vitest';

import type { EventStore } from '../event-store.ts';
import { openLedgerWith } from './open-ledger.ts';

export interface LedgerEntry {
  readonly mostEventsInOneAppend: number;
  readonly afterClosing: string;
  readonly closedWhileWriting: string;
  readonly aDatabase: () => Promise<string>;
  readonly ledgerOn: (database: string) => Layer.Layer<Ledger>;
  readonly storeOn: (database: string) => EventStore;
  readonly untilReadable: (database: string) => Promise<void>;
}

export async function aLedger(entry: LedgerEntry, database?: string): Promise<Ledger['Service']> {
  const { ledger, dispose } = await openLedgerWith(entry.ledgerOn(database ?? (await entry.aDatabase())));
  onTestFinished(dispose);
  return ledger;
}

export async function aStore(entry: LedgerEntry): Promise<EventStore> {
  const store = entry.storeOn(await entry.aDatabase());
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

export const tallies = 'org/acme/tallies';

export const changedWhileDeciding = 'The state changed while the command was decided';
