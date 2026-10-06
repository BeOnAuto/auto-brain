import { Ledger } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import type { LedgerStore } from './event-store.ts';
import { makeLedger } from './ledger-service.ts';

export function ledgerLayerOver(open: () => LedgerStore): Layer.Layer<Ledger> {
  return Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const store = yield* Effect.acquireRelease(Effect.sync(open), (opened) => Effect.promise(() => opened.close()));
      yield* Effect.promise(() => store.migrate());
      return makeLedger(store);
    }),
  );
}
