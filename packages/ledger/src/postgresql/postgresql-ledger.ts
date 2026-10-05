import type { Ledger } from '@beonauto/operations';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import { Effect, Layer } from 'effect';
import { Pool } from 'pg';

import { emmettEventStore } from '../emmett/emmett-event-store.ts';
import type { EventStore } from '../event-store.ts';
import { ledgerLayerOver } from '../ledger-layer.ts';
import { dataAsJsonText } from './json-text.ts';
import { lostConnectionsLoggedWith } from './lost-connections.ts';

export interface PostgreSQLOptions {
  readonly connectionString: string;
}

export interface PostgreSQLStoreOptions extends PostgreSQLOptions {
  readonly reportLostConnection: (error: Readonly<Error>) => void;
}

const eventsInOneBoundedAppend = 64;

export function postgresqlEventStore({ connectionString, reportLostConnection }: PostgreSQLStoreOptions): EventStore {
  const pool = new Pool({ connectionString });
  pool.on('error', reportLostConnection);
  const store = emmettEventStore(
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionString,
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
    }),
    { data: dataAsJsonText, mostEventsInOneAppend: eventsInOneBoundedAppend },
  );
  return {
    ...store,
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
}

export function postgresqlLedgerLayer(options: PostgreSQLOptions): Layer.Layer<Ledger> {
  return Layer.unwrap(
    Effect.map(Effect.context(), (context) =>
      ledgerLayerOver(() =>
        postgresqlEventStore({ ...options, reportLostConnection: lostConnectionsLoggedWith(context) }),
      ),
    ),
  );
}
