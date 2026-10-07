import { BrainContext, defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specStanding, specWordsFor, whatItDoes } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { findSpec } from '../registry/registry-lookup.ts';
import { DefinitionSchema } from '../registry/spec.ts';
import { loadRegistry, reactingSince } from './registry-access.ts';
import { SpecNameField } from './spec-fields.ts';
import { specOf } from './spec-views.ts';

export function defineGetSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineQuery('brain', {
      name: 'get_spec',
      title: 'Get definition',
      description: [
        'Reads one function or workflow definition with its document and returns it, active or retired, with its version and the input and output its document declares.',
        'For a recall function it also returns the standing of its view: live, rebuilding, waiting or stalled, the events it has folded and how far it lags the brain.',
        'Use it to show the person a definition or to learn the input a run takes; list_specs lists the definitions of a type.',
        "`primitive` is the definition's type and `name` its name.",
      ].join(' '),
      route: { method: 'GET', path: '/specs/{primitive}/{name}' },
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        const registry = yield* loadRegistry(primitive.name);
        const stored = yield* findSpec(registry, primitive.name, name);
        const spec =
          stored.reacts === true && stored.status === 'active'
            ? { ...specOf(primitive, stored), reacts_since: yield* reactingSince(primitive.name, stored) }
            : specOf(primitive, stored);
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
