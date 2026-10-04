import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specWordsFor, whatItDoes } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { SpecSchema } from '../registry/spec.ts';
import { recordInRegistry } from './registry-access.ts';
import { SourceField, SpecNameField } from './spec-fields.ts';
import { contentOf, specOf } from './spec-views.ts';

export function defineUpdateSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'update_spec',
      title: 'Update spec',
      description: known.describe([
        'Replaces the document of an active spec of the brain and returns the spec at its new version.',
        '`primitive` names the primitive and `name` the spec.',
        '`source` is the whole new document, at most 65536 bytes in UTF-8, written as its primitive describes below.',
        'Every update that changes the document makes a new version, one more than the last;',
        'an update with the same document succeeds and records nothing.',
        'Rejected with not_found when there is no such primitive or spec;',
        'with invalid_input when the primitive cannot parse the document, with issues under /source that say',
        'where in the document and what is wrong, and nothing is stored;',
        'and with conflict when the spec is retired, or when another change to the specs of the primitive landed',
        'at the same moment, in which case try again.',
      ]),
      route: { method: 'PUT', path: '/specs/{primitive}/{name}' },
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField, source: SourceField }),
      outputSchema: SpecSchema,
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
