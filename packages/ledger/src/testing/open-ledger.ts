import { Ledger } from '@beonauto/operations';
import { Effect, ManagedRuntime, type Result } from 'effect';

import { ledgerLayer } from '../sqlite3.ts';

export interface OpenLedger {
  readonly ledger: Ledger['Service'];
  readonly dispose: () => Promise<void>;
}

export async function openLedger(fileName = ':memory:'): Promise<OpenLedger> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  const ledger = await runtime.runPromise(Ledger);
  return { ledger, dispose: () => runtime.dispose() };
}

export function outcomeOf<A, E>(effect: Effect.Effect<A, E>): Promise<Result.Result<A, E>> {
  return Effect.runPromise(Effect.result(effect));
}
