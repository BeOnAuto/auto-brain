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
      description: known.describe([
        'Replaces the document of an active function or workflow definition and returns its new version.',
        '`primitive` selects the API type identifier and `name` the definition.',
        '`source` is the whole new document, at most 65536 bytes in UTF-8, in the format described below.',
        'Every update that changes the document makes a new version, one more than the last;',
        'an update with the same document succeeds and records nothing.',
        'Rejected with not_found when the type or definition is unavailable;',
        'with invalid_input when the parser rejects the document, with issues under /source that say',
        'where in the document and what is wrong, and nothing is stored;',
        'and with conflict when the definition is retired, or when another change to definitions of that type landed',
        'at the same moment, in which case try again.',
      ]),
      route: { method: 'PUT', path: '/specs/{primitive}/{name}' },
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField, source: SourceField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'invalid_input', 'conflict'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, source }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        const content = yield* contentOf(primitive, source);
        return specOf(primitive, yield* recordInRegistry(primitive.name, { type: 'update', name, content }));
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
