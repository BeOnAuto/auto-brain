import { defineCommand, quoted } from '@beonauto/operations';
import { Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/brain-words.ts';
import { PlaybookSchema } from '../registry/brain.ts';
import { PlaybookDescriptionField, PlaybookIdField, PlaybookNameField } from './brain-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const updatePlaybook = defineCommand('org', {
  name: 'update_playbook',
  title: 'Update playbook',
  description: [
    'Replaces the name and the description of an active playbook and returns the playbook.',
    'Use it when the person renames a playbook or changes what it is for; a retired playbook cannot change.',
    '`playbook` is the id of the playbook, `name` its name and `description` what it is for, both given in full even when one of them stays the same,',
    'and a call that changes nothing records nothing.',
  ].join(' '),
  repeatable: true,
  route: { method: 'PUT', path: '/playbooks/{playbook}' },
  inputSchema: Schema.Struct({
    playbook: PlaybookIdField,
    name: PlaybookNameField,
    description: PlaybookDescriptionField,
  }),
  outputSchema: PlaybookSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ playbook, name, description }) => recordInRegistry({ type: 'update', playbook, name, description }),
  plainLanguage: {
    task: 'update a playbook',
    attempt: ({ playbook }) => `update the playbook ${quoted(playbook)}`,
    outcome: (playbook) => `Updated ${playbookNamed(playbook)}.${purposeOf(playbook, ' It has no description now.')}`,
  },
});
