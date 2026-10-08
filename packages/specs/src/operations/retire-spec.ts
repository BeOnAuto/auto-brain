import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { specWordsFor } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { DefinitionSchema } from '../registry/spec.ts';
import { recordInRegistry } from './registry-access.ts';
import { SpecNameField } from './spec-fields.ts';
import { specOf } from './spec-views.ts';

export function defineRetireSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = specWordsFor(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'retire_spec',
      title: 'Retire definition',
      description: [
        'Retires a function or workflow definition for good and returns it: it can still be read and listed, but it can no longer run or change, its name is not used again in the brain, and there is no way to restore it.',
        'Use it only when the person asks to retire that definition; update_spec changes it instead.',
        '`primitive` and `name` say which definition, and retiring one already retired changes nothing.',
      ].join(' '),
      irreversible: true,
      repeatable: true,
      route: { method: 'POST', path: '/specs/{primitive}/{name}/retire' },
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'conflict'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        return specOf(primitive, yield* recordInRegistry(primitive, { type: 'retire', name }));
      }),
      plainLanguage: {
        task: `retire a ${words.kinds}`,
        attempt: ({ primitive, name }) => `retire ${words.named(primitive, name)}`,
        outcome: ({ primitive, name }) =>
          `Retired ${words.named(primitive, name)}. It can no longer be run or changed, and its name cannot be used again in this brain.`,
      },
    }),
  );
}
