import { defineCommand } from '@beonauto/operations';
import { Schema } from 'effect';

import { BrainSchema } from '../roster/brain.ts';
import { BrainIdField } from './brain-fields.ts';
import { recordOnRoster } from './roster-recording.ts';

export const retireBrain = defineCommand('org', {
  name: 'retire_brain',
  title: 'Retire brain',
  description: [
    'Retires a brain of the org for good and returns it. There is no way to restore it.',
    '`brain` is the id of the brain.',
    'A retired brain can still be read with get_brain and listed with include_retired,',
    'but it can no longer be updated, operations within it refuse it as not_found, and its id is never reused.',
    'Retiring a brain that is already retired succeeds and changes nothing.',
    'Refused with not_found when the org has no brain with that id,',
    "and with conflict when another change to the org's brains landed at the same moment, in which case try again.",
  ].join(' '),
  route: { method: 'POST', path: '/brains/{brain}/retire' },
  inputSchema: Schema.Struct({ brain: BrainIdField }),
  outputSchema: BrainSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ brain }) => recordOnRoster({ type: 'retire', brain }),
});
