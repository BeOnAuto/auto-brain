import { Effect, Layer } from 'effect';

import { BrainRegistry, type BrainAddress } from '../index.ts';

export function memoryBrainRegistry(brains: readonly BrainAddress[]): Layer.Layer<BrainRegistry> {
  return Layer.succeed(
    BrainRegistry,
    BrainRegistry.of({
      exists: ({ org, brain }) => Effect.succeed(brains.some((known) => known.org === org && known.brain === brain)),
    }),
  );
}
