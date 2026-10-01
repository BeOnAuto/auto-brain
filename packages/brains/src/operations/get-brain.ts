import { defineQuery } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { BrainSchema } from '../roster/brain.ts';
import { brainIn } from '../roster/roster-lookup.ts';
import { BrainIdField } from './brain-fields.ts';
import { readRoster } from './roster-reading.ts';

export const getBrain = defineQuery('org', {
  name: 'get_brain',
  title: 'Get brain',
  description: [
    'Reads one brain of the org and returns it, active or retired.',
    '`brain` is the id of the brain.',
    'Refused with not_found when the org has no brain with that id.',
  ].join(' '),
  route: { method: 'GET', path: '/brains/{brain}' },
  inputSchema: Schema.Struct({ brain: BrainIdField }),
  outputSchema: BrainSchema,
  reasons: ['not_found'],
  handle: ({ brain }) => readRoster.pipe(Effect.flatMap((roster) => brainIn(roster, brain))),
});
