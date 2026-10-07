import { defineCommand, quoted } from '@beonauto/operations';
import { Schema } from 'effect';

import { brainNamed, purposeOf } from '../plain-language/brain-words.ts';
import { BrainSchema } from '../registry/brain.ts';
import { BrainDescriptionField, BrainIdField, BrainNameField } from './brain-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const updateBrain = defineCommand('org', {
  name: 'update_brain',
  title: 'Update brain',
  description: [
    'Replaces the name and the description of an active brain of the org and returns the brain.',
    '`brain` is the id of the brain.',
    'Send both `name`, 1 to 100 characters and not all whitespace,',
    'and `description`, up to 2000 characters or empty to clear it, even when only one of them changes.',
  ].join(' '),
  route: { method: 'PUT', path: '/brains/{brain}' },
  inputSchema: Schema.Struct({ brain: BrainIdField, name: BrainNameField, description: BrainDescriptionField }),
  outputSchema: BrainSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ brain, name, description }) => recordInRegistry({ type: 'update', brain, name, description }),
  plainLanguage: {
    task: 'update a brain',
    attempt: ({ brain }) => `update the brain ${quoted(brain)}`,
    outcome: (brain) => `Updated ${brainNamed(brain)}.${purposeOf(brain, ' It has no description now.')}`,
  },
});
