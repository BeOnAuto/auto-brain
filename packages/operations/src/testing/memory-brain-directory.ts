import { Effect, Layer } from 'effect';

import { BrainDirectory, type BrainAddress } from '../index.ts';

export function memoryBrainDirectory(brains: readonly BrainAddress[]): Layer.Layer<BrainDirectory> {
  return Layer.succeed(
    BrainDirectory,
    BrainDirectory.of({
      exists: ({ org, brain }) => Effect.succeed(brains.some((known) => known.org === org && known.brain === brain)),
    }),
  );
}
