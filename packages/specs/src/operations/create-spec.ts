import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specWordsFor, whatItDoes } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { DefinitionSchema } from '../registry/spec.ts';
import { recordInRegistry } from './registry-access.ts';
import { SourceField, SpecNameField } from './spec-fields.ts';
import { contentOf, specOf } from './spec-views.ts';

export function defineCreateSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'create_spec',
      title: 'Create definition',
      description: [
        'Saves a new function or workflow definition in the brain from its document and returns it without running it.',
        'Use it once the person has agreed to the definition; update_spec changes one that exists, and a name is never reused in a brain.',
        `\`primitive\` is the definition's type and \`name\` is how workflows and tools refer to it: ${known.typesWithGuides}.`,
        "`source` is the whole document in that type's format, which get_guide gives.",
        'A document that does not fit its format is refused with the line and what is wrong, and nothing is saved.',
      ].join(' '),
      route: { method: 'POST', path: '/specs/{primitive}' },
      successStatus: 201,
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField, source: SourceField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, source }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        const content = yield* contentOf(primitive, source);
        return specOf(primitive, yield* recordInRegistry(primitive, { type: 'create', name, content }));
      }),
      plainLanguage: {
        task: `create a new ${words.kinds}`,
        attempt: ({ primitive, name }) => `create ${words.named(primitive, name)}`,
        outcome: (spec) =>
          `Created ${words.named(spec.primitive, spec.name)}.${whatItDoes(spec)} It has been saved but has not been run yet.`,
      },
    }),
  );
}
