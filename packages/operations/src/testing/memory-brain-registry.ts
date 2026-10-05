import { Effect, Layer } from 'effect';

import { BrainRegistry, type BrainAddress, type BrainStatus } from '../index.ts';

function holds(brains: readonly BrainAddress[], { org, brain }: BrainAddress): boolean {
  return brains.some((known) => known.org === org && known.brain === brain);
}

export function memoryBrainRegistry(
  active: readonly BrainAddress[],
  retired: readonly BrainAddress[] = [],
): Layer.Layer<BrainRegistry> {
  const statusOf = (address: BrainAddress): BrainStatus => {
    if (holds(active, address)) {
      return 'active';
    }
    return holds(retired, address) ? 'retired' : 'unknown';
  };
  return Layer.succeed(BrainRegistry, BrainRegistry.of({ status: (address) => Effect.succeed(statusOf(address)) }));
}
