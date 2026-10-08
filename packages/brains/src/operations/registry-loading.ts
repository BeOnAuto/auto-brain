import { OrgReader, type NotFound } from '@beonauto/operations';
import { Effect } from 'effect';

import type { Brain } from '../registry/brain.ts';
import { brainsStream } from '../registry/brains-stream.ts';
import { registryDecider } from '../registry/registry-decider.ts';
import { findBrain } from '../registry/registry-lookup.ts';
import type { Registry } from '../registry/registry.ts';

export const loadRegistry: Effect.Effect<Registry, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(brainsStream, registryDecider);
  return state;
});

export function foundBrain(brain: string): Effect.Effect<Brain, NotFound, OrgReader> {
  return loadRegistry.pipe(Effect.flatMap((registry) => findBrain(registry, brain)));
}
