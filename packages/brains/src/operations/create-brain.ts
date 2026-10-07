import { defineCommand, quoted } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { brainNamed, purposeOf } from '../plain-language/brain-words.ts';
import { BrainSchema } from '../registry/brain.ts';
import { BrainDescriptionField, BrainIdField, BrainNameField } from './brain-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const createBrain = defineCommand('org', {
  name: 'create_brain',
  title: 'Create brain',
  description: [
    'Creates a brain in the org and returns it, active.',
    '`brain` is the id of the new brain: 3 to 48 lowercase letters, digits and hyphens, starting with a letter.',
    '`name` is the display name, 1 to 100 characters and not all whitespace.',
    '`description` is optional text on what the brain is for, up to 2000 characters; it defaults to empty.',
  ].join(' '),
  route: { method: 'POST', path: '/brains' },
  successStatus: 201,
  inputSchema: Schema.Struct({
    brain: BrainIdField,
    name: BrainNameField,
    description: Schema.optionalKey(BrainDescriptionField),
  }),
  outputSchema: BrainSchema,
  reasons: ['conflict'],
  handle: ({ brain, name, description = '' }) =>
    recordInRegistry({ type: 'create', brain, name, description }).pipe(Effect.catchTag('not_found', Effect.die)),
  plainLanguage: {
    task: 'create a brain',
    attempt: ({ brain }) => `create the brain ${quoted(brain)}`,
    outcome: (brain) => `Created ${brainNamed(brain)}.${purposeOf(brain)} It has nothing in it yet.`,
  },
});
