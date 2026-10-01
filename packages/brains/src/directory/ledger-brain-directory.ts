import { BrainDirectory, Ledger } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { brainRegistry } from '../registry/brain-registry.ts';
import { brainsStreamOfOrg } from '../registry/brains-stream.ts';

export const ledgerBrainDirectory: Layer.Layer<BrainDirectory, never, Ledger> = Layer.effect(
  BrainDirectory,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return BrainDirectory.of({
      exists: ({ org, brain }) =>
        ledger
          .load(brainsStreamOfOrg(org), brainRegistry)
          .pipe(Effect.map(({ state }) => state.get(brain)?.status === 'active')),
    });
  }),
);
