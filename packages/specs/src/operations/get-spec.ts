import { BrainContext, defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specStanding, specWordsFor, whatItDoes } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { findSpec } from '../registry/registry-lookup.ts';
import { DefinitionSchema } from '../registry/spec.ts';
import { loadRegistry } from './registry-access.ts';
import { SpecNameField } from './spec-fields.ts';
import { specOf } from './spec-views.ts';

export function defineGetSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineQuery('brain', {
      name: 'get_spec',
      title: 'Get definition',
      description: known.describe([
        'Reads one function or workflow definition with its document and returns it, active or retired.',
        'For a recall function it also returns its standing: the view it keeps, whether that view is live, rebuilding, waiting or stalled, the events folded and how far it lags the brain.',
        '`primitive` selects the API type identifier and `name` the definition.',
        'Rejected with not_found when that type is unavailable, or no definition of that type and name exists in the brain.',
      ]),
      route: { method: 'GET', path: '/specs/{primitive}/{name}' },
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        const registry = yield* loadRegistry(primitive.name);
        const spec = specOf(primitive, yield* findSpec(registry, primitive.name, name));
        const { org, brain } = yield* BrainContext;
        const standing = yield* primitive.standing({ org, brain, name, version: spec.version, status: spec.status });
        return standing === undefined ? spec : { ...spec, standing };
      }),
      plainLanguage: {
        task: `look up a ${words.kinds}`,
        attempt: ({ primitive, name }) => `look up ${words.named(primitive, name)}`,
        outcome: (spec) => `${specStanding(words, spec)}${whatItDoes(spec)}`,
      },
    }),
  );
}
