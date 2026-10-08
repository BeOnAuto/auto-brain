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
    'Replaces the name and the description of an active brain and returns the brain.',
    'Use it when the person renames a brain or changes what it is for; a retired brain cannot change.',
    '`brain` is the id of the brain, `name` its name and `description` what it is for, both given in full even when one of them stays the same,',
    'and a call that changes nothing records nothing.',
  ].join(' '),
  repeatable: true,
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
