import { defineCommand, quoted } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/brain-words.ts';
import { PlaybookSchema } from '../registry/brain.ts';
import { PlaybookDescriptionField, PlaybookIdField, PlaybookNameField } from './brain-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const createPlaybook = defineCommand('org', {
  name: 'create_playbook',
  title: 'Create playbook',
  description: [
    "Creates a playbook in the org for one business responsibility, such as reviewing campaign briefs or keeping a team's meeting notes,",
    'and returns it, active and empty: its functions and workflows come next.',
    'Use it when the person wants a new playbook; list_playbooks shows the playbooks that exist, and an id that is taken or retired is refused.',
    "`playbook` is the id every tool inside the playbook takes, `name` is what people call it, and `description` says what the playbook is for, in the person's words.",
  ].join(' '),
  route: { method: 'POST', path: '/playbooks' },
  successStatus: 201,
  inputSchema: Schema.Struct({
    playbook: PlaybookIdField,
    name: PlaybookNameField,
    description: Schema.optionalKey(PlaybookDescriptionField),
  }),
  outputSchema: PlaybookSchema,
  reasons: ['conflict'],
  handle: ({ playbook, name, description = '' }) =>
    recordInRegistry({ type: 'create', playbook, name, description }).pipe(Effect.catchTag('not_found', Effect.die)),
  plainLanguage: {
    task: 'create a playbook',
    attempt: ({ playbook }) => `create the playbook ${quoted(playbook)}`,
    outcome: (playbook) =>
      `Created ${playbookNamed(playbook)}.${purposeOf(playbook)} Its functions and workflows come next.`,
  },
});
