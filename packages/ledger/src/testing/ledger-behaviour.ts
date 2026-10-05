import { commandsBehaviour } from './commands-behaviour.ts';
import { eventsBehaviour } from './events-behaviour.ts';
import type { LedgerEntry } from './ledger-entry.ts';
import { storeBehaviour } from './store-behaviour.ts';

export function ledgerBehaviour(entry: LedgerEntry): void {
  commandsBehaviour(entry);
  eventsBehaviour(entry);
  storeBehaviour(entry);
}
