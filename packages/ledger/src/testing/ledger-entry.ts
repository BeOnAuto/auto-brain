import type { Ledger, RunOutcomeMapping, KeyedProjection } from '@beonauto/operations';
import type { Layer } from 'effect';
import { onTestFinished } from 'vitest';

import type { LedgerStore } from '../event-store.ts';
import { openLedgerWith } from './open-ledger.ts';

export interface LedgerEntry {
  readonly mostEventsInOneAppend: number;
  readonly afterClosing: string;
  readonly closedWhileWriting: string;
  readonly aDatabase: () => Promise<string>;
  readonly ledgerOn: (
    database: string,
    runOutcomes?: RunOutcomeMapping,
    projections?: readonly KeyedProjection[],
  ) => Layer.Layer<Ledger>;
  readonly storeOn: (database: string) => LedgerStore;
  readonly untilReadable: (database: string) => Promise<void>;
  readonly queried: (database: string, statement: string) => Promise<readonly unknown[]>;
  readonly definitionStreamsIndexed: (database: string) => Promise<boolean>;
  readonly outcomeTables: string;
  readonly projectionTables: string;
  readonly projectionIndexes: string;
  readonly topicTables: string;
}

export async function aLedger(
  entry: LedgerEntry,
  database?: string,
  runOutcomes?: RunOutcomeMapping,
  projections?: readonly KeyedProjection[],
): Promise<Ledger['Service']> {
  const { ledger, dispose } = await openLedgerWith(
    entry.ledgerOn(database ?? (await entry.aDatabase()), runOutcomes, projections),
  );
  onTestFinished(dispose);
  return ledger;
}

export async function aStore(entry: LedgerEntry): Promise<LedgerStore> {
  const store = entry.storeOn(await entry.aDatabase());
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

export const tallies = 'org/acme/tallies';

export const changedWhileDeciding = 'The state changed while the command was decided';
