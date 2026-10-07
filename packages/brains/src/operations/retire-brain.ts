import { defineCommand, quoted } from '@beonauto/operations';
import { Schema } from 'effect';

import { brainNamed } from '../plain-language/brain-words.ts';
import { BrainSchema } from '../registry/brain.ts';
import { BrainIdField } from './brain-fields.ts';
import { recordInRegistry } from './registry-recording.ts';

export const retireBrain = defineCommand('org', {
  name: 'retire_brain',
  title: 'Retire brain',
  description: [
    'Retires a brain of the org for good and returns it. There is no way to restore it.',
    '`brain` is the id of the brain.',
  ].join(' '),
  route: { method: 'POST', path: '/brains/{brain}/retire' },
  inputSchema: Schema.Struct({ brain: BrainIdField }),
  outputSchema: BrainSchema,
  reasons: ['not_found', 'conflict'],
  handle: ({ brain }) => recordInRegistry({ type: 'retire', brain }),
  plainLanguage: {
    task: 'retire a brain',
    attempt: ({ brain }) => `retire the brain ${quoted(brain)}`,
    outcome: (brain) => `Retired ${brainNamed(brain)}. It can no longer change, and there is no way to restore it.`,
  },
});
