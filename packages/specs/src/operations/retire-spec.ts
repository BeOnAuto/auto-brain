import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { SpecSchema } from '../registry/spec.ts';
import { recordInRegistry } from './registry-access.ts';
import { SpecNameField } from './spec-fields.ts';
import { specOf } from './spec-views.ts';

export function defineRetireSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  return defineCommand('brain', {
    name: 'retire_spec',
    title: 'Retire spec',
    description: known.describe([
      'Retires a spec of the brain for good and returns it. There is no way to restore it.',
      '`primitive` names the primitive and `name` the spec.',
      'A retired spec can still be read with get_spec and listed with include_retired,',
      'but it can no longer be updated or executed, and its name is never reused.',
      'Retiring a spec that is already retired succeeds and changes nothing.',
      'Rejected with not_found when there is no such primitive or spec,',
      'and with conflict when another change to the specs of the primitive landed at the same moment,',
      'in which case try again.',
    ]),
    route: { method: 'POST', path: '/specs/{primitive}/{name}/retire' },
    inputSchema: Schema.Struct({ primitive: known.field, name: SpecNameField }),
    outputSchema: SpecSchema,
    reasons: ['not_found', 'conflict'],
    handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name }) {
      const primitive = yield* known.primitiveNamed(primitiveName);
      return specOf(primitive, yield* recordInRegistry(primitive.name, { type: 'retire', name }));
    }),
  });
}
