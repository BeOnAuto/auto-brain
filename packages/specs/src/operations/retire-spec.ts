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
      description: known.describe([
        'Retires a function or workflow definition for good and returns it. There is no way to restore it.',
        '`primitive` selects the API type identifier and `name` the definition.',
        'A retired definition can still be read with get_spec and listed with include_retired,',
        'but it can no longer be updated or executed, and its name is never reused.',
        'Retiring a definition that is already retired succeeds and changes nothing.',
        'Rejected with not_found when the type or definition is unavailable,',
        'and with conflict when another change to definitions of that type landed at the same moment,',
        'in which case try again.',
      ]),
      route: { method: 'POST', path: '/specs/{primitive}/{name}/retire' },
      inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField }),
      outputSchema: DefinitionSchema,
      reasons: ['not_found', 'conflict'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        return specOf(primitive, yield* recordInRegistry(primitive.name, { type: 'retire', name }));
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
