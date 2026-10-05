import type { Ledger } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { ledgerLayerOver } from '../ledger-layer.ts';
import { lostConnectionsLoggedWith } from './lost-connections.ts';
import { postgresqlEventStore, type PostgreSQLOptions } from './postgresql-event-store.ts';

export { postgresqlEventStore, type PostgreSQLOptions, type PostgreSQLStoreOptions } from './postgresql-event-store.ts';

export function postgresqlLedgerLayer(options: PostgreSQLOptions): Layer.Layer<Ledger> {
  return Layer.unwrap(
    Effect.map(Effect.context(), (context) =>
      ledgerLayerOver(() =>
        postgresqlEventStore({ ...options, reportLostConnection: lostConnectionsLoggedWith(context) }),
      ),
    ),
  );
}
