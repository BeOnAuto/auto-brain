import type { Ledger, RunOutcomeMapping } from '@beonauto/operations';
import { dumbo } from '@event-driven-io/dumbo';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import type { Layer } from 'effect';

import { dataAsWritten, emmettEventStore } from './emmett/emmett-event-store.ts';
import type { LedgerStore } from './event-store.ts';
import { ledgerLayerOver } from './ledger-layer.ts';
import {
  prepareSQLiteRunOutcomes,
  sqliteRunOutcomeProjections,
  sqliteRunOutcomesReader,
} from './outcomes/sqlite-run-outcomes.ts';
import { createSQLiteBrainIndexes, sqliteRecordedStore } from './recorded/sqlite-recorded.ts';

type AnyDriver = Parameters<typeof getSQLiteEventStore>[0]['driver'];

const eventsWithinAHundredParameters = 8;

export type SQLiteStoreOptions<Driver extends AnyDriver> = Parameters<typeof getSQLiteEventStore<Driver>>[0];

export function sqliteEventStore<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
  runOutcomes?: RunOutcomeMapping,
): LedgerStore {
  const options = optionsOf();
  const pool =
    options.pool ?? dumbo({ serialization: options.serialization, ...options.driver.mapToDumboOptions(options) });
  const store = getSQLiteEventStore({
    ...options,
    pool,
    schema: { autoMigration: 'None' },
    projections: [...(options.projections ?? []), ...sqliteRunOutcomeProjections(runOutcomes)],
  });
  const streams = emmettEventStore(store, {
    data: dataAsWritten,
    mostEventsInOneAppend: eventsWithinAHundredParameters,
  });
  return {
    ...streams,
    ...sqliteRecordedStore(pool.execute),
    readRunOutcomes: sqliteRunOutcomesReader(pool.execute),
    migrate: async () => {
      await streams.migrate();
      await createSQLiteBrainIndexes(pool.execute);
      await prepareSQLiteRunOutcomes(pool, runOutcomes);
    },
  };
}

export function sqliteLedgerLayer<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
  runOutcomes?: RunOutcomeMapping,
): Layer.Layer<Ledger> {
  return ledgerLayerOver(() => sqliteEventStore(optionsOf, runOutcomes));
}
