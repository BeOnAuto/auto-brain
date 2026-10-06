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
      description: known.describe([
        'Creates a function or workflow definition from its document and returns it, active at version 1.',
        '`primitive` selects its API type identifier from the list below.',
        '`name` names the new definition: 3 to 48 lowercase letters, digits and hyphens, starting with a letter.',
        'The name must be new among definitions of that type in the brain:',
        'a name is never reused, not even after its definition is retired.',
        '`source` is the definition document, at most 65536 bytes in UTF-8, in the format described below.',
        'Rejected with not_found when that definition type is unavailable;',
        'with invalid_input when the parser rejects the document, with issues under /source that say',
        'where in the document and what is wrong, and nothing is stored;',
        'and with conflict when the name is taken, or when another change to definitions of that type landed',
        'at the same moment, in which case try again.',
      ]),
      route: { method: 'POST', path: '/specs/{primitive}' },
      successStatus: 201,
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField, source: SourceField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, source }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        const content = yield* contentOf(primitive, source);
        return specOf(primitive, yield* recordInRegistry(primitive.name, { type: 'create', name, content }));
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
