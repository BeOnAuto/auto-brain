import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { ListedSpecSchema } from '../registry/spec.ts';
import { loadRegistry } from './registry-access.ts';
import { IncludeRetiredField } from './spec-fields.ts';
import { byName, listedSpecOf } from './spec-views.ts';

export function defineListSpecs(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  return defineQuery('brain', {
    name: 'list_specs',
    title: 'List specs',
    description: known.describe([
      'Lists the specs of one primitive in the brain, sorted by name, without their documents.',
      '`primitive` names the primitive. Retired specs are left out unless `include_retired` is true.',
      'Each spec carries its name, version, status (active or retired), the media type of its document,',
      'what its document says it does and the JSON Schemas of its input and output when the document gives them,',
      'the id of the caller who created it, and when it was created, last changed and retired.',
      'Read one spec with its document with get_spec.',
      'Rejected with not_found when there is no such primitive.',
    ]),
    route: { method: 'GET', path: '/specs/{primitive}' },
    inputSchema: Schema.Struct({
      primitive: known.field,
      include_retired: Schema.optionalKey(IncludeRetiredField),
    }),
    outputSchema: Schema.Struct({ specs: Schema.Array(ListedSpecSchema) }),
    reasons: ['not_found'],
    handle: Effect.fnUntraced(function* ({ primitive: primitiveName, include_retired: includeRetired = false }) {
      const primitive = yield* known.primitiveNamed(primitiveName);
      const registry = yield* loadRegistry(primitive.name);
      const specs = [...registry.values()].filter(({ status }) => includeRetired || status === 'active');
      return { specs: specs.toSorted(byName).map((spec) => listedSpecOf(primitive, spec)) };
    }),
  });
}
