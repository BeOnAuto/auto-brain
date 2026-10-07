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
    'Lists the brains of the org that the caller may access, sorted by id, each with its name, what it is for and whether it is active.',
    'Use it to find a brain the person names, or to see whether one exists before another is made; get_brain reads one brain by its id.',
    '`include_retired` adds the retired brains, which are left out otherwise.',
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
