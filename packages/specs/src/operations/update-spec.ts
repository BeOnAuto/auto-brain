import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specWordsFor, whatItDoes } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { DefinitionSchema } from '../registry/spec.ts';
import { recordInRegistry } from './registry-access.ts';
import { SourceField, SpecNameField } from './spec-fields.ts';
import { contentOf, specOf } from './spec-views.ts';

export function defineUpdateSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'update_spec',
      title: 'Update definition',
      description: [
        'Replaces the whole document of an active function or workflow definition and returns its new version, which every run uses from then on.',
        'Use it when the person changes a saved definition; create_spec saves a new one, and a retired definition cannot change.',
        "`primitive` and `name` say which definition, and `source` is the whole new document in its type's format, which get_guide gives.",
        'A document that does not fit its format is refused with the line and what is wrong, and one the same as the saved document records nothing.',
        "A new version of a recall function builds its view again from the brain's history.",
      ].join(' '),
      repeatable: true,
      route: { method: 'PUT', path: '/specs/{primitive}/{name}' },
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField, source: SourceField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, source }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        const content = yield* contentOf(primitive, source);
        return specOf(primitive, yield* recordInRegistry(primitive, { type: 'update', name, content }));
      }),
      plainLanguage: {
        task: `update a ${words.kinds}`,
        attempt: ({ primitive, name }) => `update ${words.named(primitive, name)}`,
        outcome: (spec) =>
          `Updated ${words.named(spec.primitive, spec.name)}.${whatItDoes(spec)} The change applies from its next run.`,
      },
    }),
  );
}
