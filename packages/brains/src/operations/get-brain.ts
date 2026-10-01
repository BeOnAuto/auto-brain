import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { BrainSchema } from '../registry/brain.ts';
import { findBrain } from '../registry/registry-lookup.ts';
import { BrainIdField } from './brain-fields.ts';
import { loadRegistry } from './registry-loading.ts';

export const getBrain = defineQuery('org', {
  name: 'get_brain',
  title: 'Get brain',
  description: [
    'Reads one brain of the org and returns it, active or retired.',
    '`brain` is the id of the brain.',
    'Rejected with not_found when the org has no brain with that id.',
  ].join(' '),
  route: { method: 'GET', path: '/brains/{brain}' },
  inputSchema: Schema.Struct({ brain: BrainIdField }),
  outputSchema: BrainSchema,
  reasons: ['not_found'],
  handle: ({ brain }) => loadRegistry.pipe(Effect.flatMap((registry) => findBrain(registry, brain))),
});
