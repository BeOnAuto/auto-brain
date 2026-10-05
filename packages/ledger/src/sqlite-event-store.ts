import type { Ledger } from '@beonauto/operations';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import type { Layer } from 'effect';

import { dataAsWritten, emmettEventStore } from './emmett/emmett-event-store.ts';
import type { EventStore } from './event-store.ts';
import { ledgerLayerOver } from './ledger-layer.ts';

type AnyDriver = Parameters<typeof getSQLiteEventStore>[0]['driver'];

const eventsWithinAHundredParameters = 8;

export type SQLiteStoreOptions<Driver extends AnyDriver> = Parameters<typeof getSQLiteEventStore<Driver>>[0];

export function sqliteEventStore<Driver extends AnyDriver>(optionsOf: () => SQLiteStoreOptions<Driver>): EventStore {
  return emmettEventStore(getSQLiteEventStore({ ...optionsOf(), schema: { autoMigration: 'None' } }), {
    data: dataAsWritten,
    mostEventsInOneAppend: eventsWithinAHundredParameters,
  });
}

export function sqliteLedgerLayer<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
): Layer.Layer<Ledger> {
  return ledgerLayerOver(() => sqliteEventStore(optionsOf));
}
