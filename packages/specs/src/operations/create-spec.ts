import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specWordsFor, whatItDoes } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { SpecSchema } from '../registry/spec.ts';
import { recordInRegistry } from './registry-access.ts';
import { SourceField, SpecNameField } from './spec-fields.ts';
import { contentOf, specOf } from './spec-views.ts';

export function defineCreateSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'create_spec',
      title: 'Create spec',
      description: known.describe([
        'Creates a spec of a primitive in the brain from its document and returns it, active at version 1.',
        '`primitive` names the primitive.',
        '`name` names the new spec: 3 to 48 lowercase letters, digits and hyphens, starting with a letter.',
        'The name must be new among the specs of that primitive in the brain:',
        'a name is never reused, not even after its spec is retired.',
        '`source` is the spec document, at most 65536 bytes in UTF-8, written as its primitive describes below.',
        'Rejected with not_found when there is no such primitive;',
        'with invalid_input when the primitive cannot parse the document, with issues under /source that say',
        'where in the document and what is wrong, and nothing is stored;',
        'and with conflict when the name is taken, or when another change to the specs of the primitive landed',
        'at the same moment, in which case try again.',
      ]),
      route: { method: 'POST', path: '/specs/{primitive}' },
      successStatus: 201,
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField, source: SourceField }),
      outputSchema: SpecSchema,
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
