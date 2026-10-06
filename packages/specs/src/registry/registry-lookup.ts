import { NotFound } from '@beonauto/operations';
import { Effect } from 'effect';

import { definitionResourceLabel } from '../primitive/function-terminology.ts';
import type { SpecRegistry } from './spec-registry.ts';
import type { StoredDefinition } from './spec.ts';

export function specNotFound(primitive: string, name: string): NotFound {
  return new NotFound({ detail: `There is no ${definitionResourceLabel(primitive)} ${name} in this brain` });
}

export function findSpec(
  registry: SpecRegistry,
  primitive: string,
  name: string,
): Effect.Effect<StoredDefinition, NotFound> {
  const spec = registry.get(name);
  return spec === undefined ? Effect.fail(specNotFound(primitive, name)) : Effect.succeed(spec);
}
