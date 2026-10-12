import { Ledger } from '@on.auto/operations';
import { Effect, ManagedRuntime, type Layer, type Result } from 'effect';
import { Pool } from 'pg';

import type { PostgreSQLPools } from '../postgresql/postgresql-event-store.ts';
import { ledgerLayer } from '../sqlite3.ts';

export interface OpenLedger {
  readonly ledger: Ledger['Service'];
  readonly dispose: () => Promise<void>;
}

export async function openLedgerWith(layer: Layer.Layer<Ledger>): Promise<OpenLedger> {
  const runtime = ManagedRuntime.make(layer);
  const ledger = await runtime.runPromise(Ledger);
  return { ledger, dispose: () => runtime.dispose() };
}

export function openLedger(fileName = ':memory:'): Promise<OpenLedger> {
  return openLedgerWith(ledgerLayer({ fileName }));
}

export function plainPoolsOn(connectionString: string): PostgreSQLPools {
  return ({ max }) => new Pool({ connectionString, max });
}

export function outcomeOf<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}
