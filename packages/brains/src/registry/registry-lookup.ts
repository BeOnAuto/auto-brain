import { NotFound } from '@beonauto/operations';
import { Effect } from 'effect';

import type { Brain } from './brain.ts';
import type { Registry } from './registry.ts';

export function brainNotFound(id: string): NotFound {
  return new NotFound({ detail: `There is no brain ${id} in this org` });
}

export function findBrain(registry: Registry, id: string): Effect.Effect<Brain, NotFound> {
  const brain = registry.get(id);
  return brain === undefined ? Effect.fail(brainNotFound(id)) : Effect.succeed(brain);
}
