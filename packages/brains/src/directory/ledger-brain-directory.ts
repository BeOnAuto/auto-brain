import { BrainDirectory, Ledger } from '@beonauto/operations';
import { Effect, Layer } from 'effect';

import { brainRoster } from '../roster/brain-roster.ts';
import { brainsStreamOfOrg } from '../roster/brains-stream.ts';

export const ledgerBrainDirectory: Layer.Layer<BrainDirectory, never, Ledger> = Layer.effect(
  BrainDirectory,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return BrainDirectory.of({
      exists: ({ org, brain }) =>
        ledger
          .load(brainsStreamOfOrg(org), brainRoster)
          .pipe(Effect.map(({ state }) => state.get(brain)?.status === 'active')),
    });
  }),
);
