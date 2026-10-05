import type { Ledger } from '@beonauto/operations';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import type { Layer } from 'effect';

import type { EventStore } from '../event-store.ts';
import { ledgerLayerOver } from '../ledger-layer.ts';
import { jsonTextEventStore } from './json-text-event-store.ts';

export interface PostgreSQLOptions {
  readonly connectionString: string;
}

export function postgresqlEventStore({ connectionString }: PostgreSQLOptions): EventStore {
  return jsonTextEventStore(
    getPostgreSQLEventStore({ driver: pgEventStoreDriver, connectionString, schema: { autoMigration: 'None' } }),
  );
}

export function postgresqlLedgerLayer(options: PostgreSQLOptions): Layer.Layer<Ledger> {
  return ledgerLayerOver(() => postgresqlEventStore(options));
}
