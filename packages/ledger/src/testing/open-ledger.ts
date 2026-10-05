import { Ledger } from '@beonauto/operations';
import { Effect, ManagedRuntime, type Layer, type Result } from 'effect';

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

export function outcomeOf<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}
