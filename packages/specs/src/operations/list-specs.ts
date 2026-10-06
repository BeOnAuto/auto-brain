import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specsListed, specWordsFor } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { ListedDefinitionSchema } from '../registry/spec.ts';
import { loadRegistry } from './registry-access.ts';
import { IncludeRetiredField } from './spec-fields.ts';
import { byName, listedSpecOf } from './spec-views.ts';

export function defineListSpecs(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineQuery('brain', {
      name: 'list_specs',
      title: 'List definitions',
      description: known.describe([
        'Lists definitions of one type in the brain, sorted by name, without their documents.',
        '`primitive` selects the API type identifier. Retired definitions are left out unless `include_retired` is true.',
        'Each definition carries its name, version, status (active or retired), the media type of its document,',
        'what its document says it does and the JSON Schemas of its input and output when the document gives them,',
        'the id of the caller who created it, and when it was created, last changed and retired.',
        'Read one definition with its document with get_spec.',
        'Rejected with not_found when that definition type is unavailable.',
      ]),
      route: { method: 'GET', path: '/specs/{primitive}' },
      inputSchema: Schema.Struct({
        primitive: known.field,
        include_retired: Schema.optionalKey(IncludeRetiredField),
      }),
      outputSchema: Schema.Struct({ specs: Schema.Array(ListedDefinitionSchema) }),
      reasons: ['not_found'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, include_retired: includeRetired = false }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        const registry = yield* loadRegistry(primitive.name);
        const specs = [...registry.values()].filter(({ status }) => includeRetired || status === 'active');
        return { specs: specs.toSorted(byName).map((spec) => listedSpecOf(primitive, spec)) };
      }),
      plainLanguage: {
        task: `list the ${words.allKinds}`,
        attempt: ({ primitive }) => `list the ${words.nounOf(primitive).other}`,
        outcome: ({ specs }, { primitive }) => specsListed(words.nounOf(primitive), specs),
      },
    }),
  );
}
