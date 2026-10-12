import type { Ledger } from '@on.auto/operations';
import type { Layer } from 'effect';

import type { LedgerStore } from '../event-store.ts';
import { ledgerLayerOver } from '../ledger-layer.ts';

export interface WatchedSweeps {
  readonly layer: Layer.Layer<Ledger>;
  readonly started: Promise<void>;
  readonly finished: Promise<string>;
}

export function sweepsWatched(storeOf: () => LedgerStore, held: Promise<void> = Promise.resolve()): WatchedSweeps {
  const started = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<string>();
  const open = (): LedgerStore => {
    const store = storeOf();
    return {
      ...store,
      sweepContent: async (before) => {
        started.resolve();
        await held;
        finished.resolve(await store.sweepContent(before).then(() => 'swept', String));
      },
    };
  };
  return { layer: ledgerLayerOver(open), started: started.promise, finished: finished.promise };
}
