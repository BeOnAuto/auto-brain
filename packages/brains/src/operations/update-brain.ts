import { defineCommand } from '@beonauto/operations';
import { Schema } from 'effect';

import { BrainSchema } from '../roster/brain.ts';
import { BrainDescriptionField, BrainIdField, BrainNameField } from './brain-fields.ts';
import { recordOnRoster } from './roster-recording.ts';

export const updateBrain = defineCommand('org', {
  name: 'update_brain',
  title: 'Update brain',
  description: [
    'Replaces the name and the description of an active brain of the org and returns the brain.',
    '`brain` is the id of the brain.',
    'Send both `name`, 1 to 100 characters and not all whitespace,',
    'and `description`, up to 2000 characters or empty to clear it, even when only one of them changes.',
    'Both are stored with surrounding whitespace trimmed.',
    'An update that changes nothing succeeds and records nothing.',
    'Refused with not_found when the org has no brain with that id, and with conflict when the brain is retired',
    "or when another change to the org's brains landed at the same moment, in which case try again.",
  ].join(' '),
  route: { method: 'PUT', path: '/brains/{brain}' },
  inputSchema: Schema.Struct({ brain: BrainIdField, name: BrainNameField, description: BrainDescriptionField }),
  outputSchema: BrainSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ brain, name, description }) => recordOnRoster({ type: 'update', brain, name, description }),
});
