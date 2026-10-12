import { Ledger, type ContentStore, type RunOutcomeMapping, type KeyedProjection } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { signalledOn, type AppendSignal } from './appends/append-signal.ts';
import { sweptHourly } from './content/content-sweep.ts';
import type { LedgerStore } from './event-store.ts';
import { makeLedger } from './ledger-service.ts';

export interface OpenedWith {
  readonly appends?: AppendSignal | undefined;
  readonly content?: ContentStore | undefined;
}

export interface StoreLayerOptions extends OpenedWith {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeyedProjection[] | undefined;
}

export function ledgerLayerOver(open: () => LedgerStore, { appends, content }: OpenedWith = {}): Layer.Layer<Ledger> {
  return Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const store = yield* Effect.acquireRelease(
        Effect.sync(() => signalledOn(open(), appends)),
        (opened) => Effect.promise(() => opened.close()),
      );
      yield* Effect.promise(() => store.migrate());
      const kept = content ?? store;
      yield* sweptHourly(kept);
      return makeLedger({ ...store, content: kept.content, sweepContent: kept.sweepContent });
    }),
  );
}
