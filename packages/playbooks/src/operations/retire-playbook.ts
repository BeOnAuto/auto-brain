import { defineCommand, quoted } from '@beonauto/operations';
import { Schema } from 'effect';

import { playbookNamed } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookIdField } from './playbook-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const retirePlaybook = defineCommand('org', {
  name: 'retire_playbook',
  title: 'Retire playbook',
  description: [
    'Retires a playbook of the org for good and returns it: it keeps its history and can still be read,',
    'but it can no longer change, and there is no way to restore it or to use its id again.',
    'Use it only when the person asks to retire that playbook; update_playbook changes its name or description instead.',
    '`playbook` is the id of the playbook, and retiring a playbook already retired changes nothing.',
  ].join(' '),
  irreversible: true,
  repeatable: true,
  route: { method: 'POST', path: '/playbooks/{playbook}/retire' },
  inputSchema: Schema.Struct({ playbook: PlaybookIdField }),
  outputSchema: PlaybookSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ playbook }) => recordInRegistry({ type: 'retire', playbook }),
  plainLanguage: {
    task: 'retire a playbook',
    attempt: ({ playbook }) => `retire the playbook ${quoted(playbook)}`,
    outcome: (playbook) =>
      `Retired ${playbookNamed(playbook)}. It can no longer change, and there is no way to restore it.`,
  },
});
