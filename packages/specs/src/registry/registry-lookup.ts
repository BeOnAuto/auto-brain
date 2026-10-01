import { NotFound } from '@beonauto/operations';
import { Effect } from 'effect';

import type { SpecRegistry } from './spec-registry.ts';
import type { StoredSpec } from './spec.ts';

export function specNotFound(primitive: string, name: string): NotFound {
  return new NotFound({ detail: `There is no ${primitive} spec ${name} in this brain` });
}

export function findSpec(registry: SpecRegistry, primitive: string, name: string): Effect.Effect<StoredSpec, NotFound> {
  const spec = registry.get(name);
  return spec === undefined ? Effect.fail(specNotFound(primitive, name)) : Effect.succeed(spec);
}
