import { defineQuery, quoted } from '@on.auto/operations';
import { Schema } from 'effect';

import { playbookStanding, purposeOf } from '../plain-language/playbook-words.ts';
import { PlaybookSchema } from '../registry/playbook.ts';
import { PlaybookIdField } from './playbook-fields.ts';
import { foundPlaybook } from './registry-loading.ts';

export const getPlaybook = defineQuery('org', {
  name: 'get_playbook',
  title: 'Get playbook',
  description: [
    'Reads one playbook of the org by its id and returns it, active or retired, with its name, what it is for and when it was made and changed.',
    'Use it when the person names a playbook whose id is known; list_playbooks finds the playbooks when it is not.',
    '`playbook` is the id of the playbook.',
  ].join(' '),
  route: { method: 'GET', path: '/playbooks/{playbook}' },
  inputSchema: Schema.Struct({ playbook: PlaybookIdField }),
  outputSchema: PlaybookSchema,
  reasons: ['not_found'],
  handle: ({ playbook }) => foundPlaybook(playbook),
  plainLanguage: {
    task: 'look up a playbook',
    attempt: ({ playbook }) => `look up the playbook ${quoted(playbook)}`,
    outcome: (playbook) => `${playbookStanding(playbook)}${purposeOf(playbook)}`,
  },
});
