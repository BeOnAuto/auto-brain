import { Caller, defineQuery, canAccessBrain } from '@beonauto/operations';
import { Effect, Order, Schema } from 'effect';

import { brainsListed } from '../plain-language/brain-words.ts';
import { BrainSchema, type Brain } from '../registry/brain.ts';
import { loadRegistry } from './registry-loading.ts';

const byId = Order.mapInput(Order.String, ({ id }: Brain) => id);

export const listBrains = defineQuery('org', {
  name: 'list_brains',
  title: 'List brains',
  description: [
    'Lists the brains of the org that the caller may access, sorted by id.',
    'Retired brains are left out unless `include_retired` is true.',
    'Each brain carries its id, name, description, status (active or retired), the id of the caller who created it,',
    'when it was created and last changed, and when it was retired.',
  ].join(' '),
  route: { method: 'GET', path: '/brains' },
  inputSchema: Schema.Struct({
    include_retired: Schema.optionalKey(
      Schema.Boolean.annotate({ description: 'Whether to list retired brains as well; false when left out' }),
    ),
  }),
  outputSchema: Schema.Struct({ brains: Schema.Array(BrainSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ include_retired: includeRetired = false }) {
    const { brains: access } = yield* Caller;
    const registry = yield* loadRegistry;
    const brains = [...registry.values()].filter(
      ({ id, status }) => canAccessBrain(access, id) && (includeRetired || status === 'active'),
    );
    return { brains: brains.toSorted(byId) };
  }),
  plainLanguage: {
    task: 'list the brains',
    attempt: () => 'list the brains',
    outcome: ({ brains }) => brainsListed(brains),
  },
});
