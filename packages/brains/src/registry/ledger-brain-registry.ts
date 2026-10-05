import { BrainRegistry, Ledger } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { brainsStreamOfOrg } from './brains-stream.ts';
import { registryDecider } from './registry-decider.ts';

export const ledgerBrainRegistry: Layer.Layer<BrainRegistry, never, Ledger> = Layer.effect(
  BrainRegistry,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return BrainRegistry.of({
      status: ({ org, brain }) =>
        ledger
          .load(brainsStreamOfOrg(org), registryDecider)
          .pipe(Effect.map(({ state }) => state.get(brain)?.status ?? 'unknown')),
    });
  }),
);
