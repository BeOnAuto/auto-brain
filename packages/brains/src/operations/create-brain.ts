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
    "Creates a brain in the org for one business responsibility, such as reviewing campaign briefs or keeping a team's meeting notes,",
    'and returns it, active and empty: its functions and workflows come next.',
    'Use it when the person wants a new brain; list_brains shows the brains that exist, and an id that is taken or retired is refused.',
    "`brain` is the id every tool inside the brain takes, `name` is what people call it, and `description` says what the brain is for, in the person's words.",
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
    outcome: (brain) => `Created ${brainNamed(brain)}.${purposeOf(brain)} Its functions and workflows come next.`,
  },
});
