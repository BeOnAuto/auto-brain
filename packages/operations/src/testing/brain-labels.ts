import { Effect, Result, Schema } from 'effect';

import { BrainIdSchema, NotFound, OrgReader, OrgWriter, defineCommand, defineQuery, type Decider } from '../index.ts';

const BrainLabelSchema = Schema.Struct({ brain: BrainIdSchema, label: Schema.String });

type BrainLabel = typeof BrainLabelSchema.Type;

const labelBook: Decider<readonly BrainLabel[], BrainLabel, BrainLabel> = {
  initialState: [],
  evolve: (labels, labelled) => [...labels.filter(({ brain }) => brain !== labelled.brain), labelled],
  decide: (labelled) => Result.succeed([labelled]),
  eventSchema: BrainLabelSchema,
};

export const labelBrain = defineCommand('org', {
  name: 'label_brain',
  title: 'Label brain',
  description: 'Gives a brain of the org a label.',
  route: { method: 'PUT', path: '/brains/{brain}/label' },
  inputSchema: BrainLabelSchema,
  outputSchema: BrainLabelSchema,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (labelled) {
    yield* (yield* OrgWriter).execute('brain-labels', labelBook, labelled);
    return labelled;
  }),
});

export const getBrainLabel = defineQuery('org', {
  name: 'get_brain_label',
  title: 'Get brain label',
  description: 'Reads the label of a brain of the org.',
  route: { method: 'GET', path: '/brains/{brain}/label' },
  inputSchema: Schema.Struct({ brain: BrainIdSchema }),
  outputSchema: BrainLabelSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ brain }) {
    const { state } = yield* (yield* OrgReader).load('brain-labels', labelBook);
    const found = state.find((labelled) => labelled.brain === brain);
    if (found === undefined) {
      return yield* new NotFound({ detail: `The brain ${brain} has no label` });
    }
    return found;
  }),
});

export const listBrainLabels = defineQuery('org', {
  name: 'list_brain_labels',
  title: 'List brain labels',
  description: 'Lists the labels of the brains of the org.',
  route: { method: 'GET', path: '/brain-labels' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ labels: Schema.Array(BrainLabelSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    const { state } = yield* (yield* OrgReader).load('brain-labels', labelBook);
    return { labels: state };
  }),
});
