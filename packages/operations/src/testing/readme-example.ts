import { NotFound, OrgReader, defineQuery, type Decider } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';

const LabelSchema = Schema.Struct({ name: Schema.String, text: Schema.String });

type Label = typeof LabelSchema.Type;

export const labels: Decider<readonly Label[], Label, Label> = {
  initialState: [],
  evolve: (written, label) => [...written, label],
  decide: (label) => Result.succeed([label]),
  eventSchema: LabelSchema,
};

export const getLabel = defineQuery('org', {
  name: 'get_label',
  title: 'Get label',
  description: 'Reads one label of the org.',
  route: { method: 'GET', path: '/labels/{name}' },
  inputSchema: Schema.Struct({ name: Schema.String }),
  outputSchema: LabelSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ name }) {
    const { state } = yield* (yield* OrgReader).load('labels', labels);
    const label = state.find((written) => written.name === name);
    if (label === undefined) {
      return yield* new NotFound({ detail: `There is no label ${name}` });
    }
    return label;
  }),
});
