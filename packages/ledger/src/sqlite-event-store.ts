import { dumbo } from '@event-driven-io/dumbo';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

import { dataAsWritten, emmettEventStore } from './emmett/emmett-event-store.ts';
import type { LedgerStore } from './event-store.ts';
import { ledgerLayerOver, type StoreLayerOptions } from './ledger-layer.ts';
import { sqliteRunOutcomesOf } from './outcomes/sqlite-run-outcomes.ts';
import type { KeptTables } from './projections/projection-parts.ts';
import { preparedOn, sqliteProjectionsOf } from './projections/sqlite-projections.ts';
import { sqliteSchemaCreated } from './recorded/sqlite-indexes.ts';
import { sqliteRecordedStore } from './recorded/sqlite-recorded.ts';

type AnyDriver = Parameters<typeof getSQLiteEventStore>[0]['driver'];

const eventsWithinAHundredParameters = 8;

export type SQLiteStoreOptions<Driver extends AnyDriver> = Parameters<typeof getSQLiteEventStore<Driver>>[0];

export function sqliteEventStore<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
  kept: KeptTables = {},
): LedgerStore {
  const options = optionsOf();
  const pool =
    options.pool ?? dumbo({ serialization: options.serialization, ...options.driver.mapToDumboOptions(options) });
  const projections = sqliteProjectionsOf(kept);
  const store = getSQLiteEventStore({
    ...options,
    pool,
    schema: { autoMigration: 'None' },
    projections: [...(options.projections ?? []), ...projections.registrations],
  });
  const streams = emmettEventStore(store, {
    data: dataAsWritten,
    mostEventsInOneAppend: eventsWithinAHundredParameters,
  });
  return {
    ...streams,
    ...sqliteRecordedStore(pool.execute),
    ...projections.readerOn({
      query: async (sql) => (await pool.execute.query(sql)).rows,
      command: (sql) => pool.execute.command(sql),
    }),
    readRunOutcomes: sqliteRunOutcomesOf(kept.runOutcomes, pool.execute),
    migrate: async () => {
      await streams.migrate();
      await sqliteSchemaCreated(pool.execute);
      await preparedOn(projections.prepare, pool);
    },
  };
}

export function sqliteLedgerLayer<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
  { runOutcomes, projections, appends }: StoreLayerOptions = {},
) {
  return ledgerLayerOver(() => sqliteEventStore(optionsOf, { runOutcomes, projections }), appends);
}
