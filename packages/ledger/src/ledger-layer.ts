import { Ledger, type RunOutcomeMapping, type RunProjection } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { signalledOn, type AppendSignal } from './appends/append-signal.ts';
import type { LedgerStore } from './event-store.ts';
import { makeLedger } from './ledger-service.ts';

export interface StoreLayerOptions {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly RunProjection[] | undefined;
  readonly appends?: AppendSignal | undefined;
}

export function ledgerLayerOver(open: () => LedgerStore, appends?: AppendSignal): Layer.Layer<Ledger> {
  return Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const store = yield* Effect.acquireRelease(
        Effect.sync(() => signalledOn(open(), appends)),
        (opened) => Effect.promise(() => opened.close()),
      );
      yield* Effect.promise(() => store.migrate());
      return makeLedger(store);
    }),
  );
}
