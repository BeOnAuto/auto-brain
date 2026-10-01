import { Ledger } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { ledgerOver } from './ledger-service.ts';
import { openEventStore, type LedgerOptions } from './open-event-store.ts';

export function ledgerLayer(options: LedgerOptions): Layer.Layer<Ledger> {
  return Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const store = yield* Effect.acquireRelease(
        Effect.sync(() => openEventStore(options)),
        (opened) => Effect.promise(() => opened.close()),
      );
      yield* Effect.promise(() => store.migrate());
      return ledgerOver(store);
    }),
  );
}
