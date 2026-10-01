import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { findSpec } from '../registry/registry-lookup.ts';
import { SpecSchema } from '../registry/spec.ts';
import { loadRegistry } from './registry-access.ts';
import { SpecNameField } from './spec-fields.ts';
import { specOf } from './spec-views.ts';

export function defineGetSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  return defineQuery('brain', {
    name: 'get_spec',
    title: 'Get spec',
    description: known.describe([
      'Reads one spec of the brain with its document and returns it, active or retired.',
      '`primitive` names the primitive and `name` the spec.',
      'Rejected with not_found when there is no such primitive, or no spec of that name for it in the brain.',
    ]),
    route: { method: 'GET', path: '/specs/{primitive}/{name}' },
    inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField }),
    outputSchema: SpecSchema,
    reasons: ['not_found'],
    handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name }) {
      const primitive = yield* known.primitiveNamed(primitiveName);
      const registry = yield* loadRegistry(primitive.name);
      return specOf(primitive, yield* findSpec(registry, primitive.name, name));
    }),
  });
}
