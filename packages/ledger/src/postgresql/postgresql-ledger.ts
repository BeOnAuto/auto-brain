import type { Ledger } from '@beonauto/operations';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import type { Layer } from 'effect';

import { emmettEventStore } from '../emmett/emmett-event-store.ts';
import type { EventStore } from '../event-store.ts';
import { ledgerLayerOver } from '../ledger-layer.ts';
import { dataAsJsonText } from './json-text.ts';

export interface PostgreSQLOptions {
  readonly connectionString: string;
}

const eventsInOneBoundedAppend = 64;

export function postgresqlEventStore({ connectionString }: PostgreSQLOptions): EventStore {
  return emmettEventStore(
    getPostgreSQLEventStore({ driver: pgEventStoreDriver, connectionString, schema: { autoMigration: 'None' } }),
    { data: dataAsJsonText, mostEventsInOneAppend: eventsInOneBoundedAppend },
  );
}

export function postgresqlLedgerLayer(options: PostgreSQLOptions): Layer.Layer<Ledger> {
  return ledgerLayerOver(() => postgresqlEventStore(options));
}
