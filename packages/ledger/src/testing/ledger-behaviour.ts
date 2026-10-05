import type { Ledger } from '@beonauto/operations';
import { Effect } from 'effect';

import { commandsBehaviour } from './commands-behaviour.ts';
import { eventsBehaviour } from './events-behaviour.ts';
import { aLedger, type LedgerEntry } from './ledger-entry.ts';
import { recordedBehaviour } from './recorded-behaviour.ts';
import { storeBehaviour } from './store-behaviour.ts';

async function aLedgerReadingWhatCommitted(entry: LedgerEntry): Promise<Ledger['Service']> {
  const database = await entry.aDatabase();
  const ledger = await aLedger(entry, database);
  return {
    ...ledger,
    readRecorded: (brain, selection, page) =>
      Effect.promise(() => entry.untilReadable(database)).pipe(
        Effect.andThen(ledger.readRecorded(brain, selection, page)),
      ),
  };
}

export function ledgerBehaviour(entry: LedgerEntry): void {
  commandsBehaviour(entry);
  eventsBehaviour(entry);
  storeBehaviour(entry);
  recordedBehaviour(() => aLedgerReadingWhatCommitted(entry));
}
