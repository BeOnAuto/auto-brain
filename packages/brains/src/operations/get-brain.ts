import { defineQuery, quoted } from '@beonauto/operations';
import { Schema } from 'effect';

import { brainStanding, purposeOf } from '../plain-language/brain-words.ts';
import { BrainSchema } from '../registry/brain.ts';
import { BrainIdField } from './brain-fields.ts';
import { foundBrain } from './registry-loading.ts';

export const getBrain = defineQuery('org', {
  name: 'get_brain',
  title: 'Get brain',
  description: [
    'Reads one brain of the org by its id and returns it, active or retired, with its name, what it is for and when it was made and changed.',
    'Use it when the person names a brain whose id is known; list_brains finds the brains when it is not.',
    '`brain` is the id of the brain.',
  ].join(' '),
  route: { method: 'GET', path: '/brains/{brain}' },
  inputSchema: Schema.Struct({ brain: BrainIdField }),
  outputSchema: BrainSchema,
  reasons: ['not_found'],
  handle: ({ brain }) => foundBrain(brain),
  plainLanguage: {
    task: 'look up a brain',
    attempt: ({ brain }) => `look up the brain ${quoted(brain)}`,
    outcome: (brain) => `${brainStanding(brain)}${purposeOf(brain)}`,
  },
});
