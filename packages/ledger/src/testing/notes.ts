import type { Decider } from '@beonauto/operations';
import { Result, Schema } from 'effect';

const NotedSchema = Schema.Struct({
  type: Schema.Literal('noted'),
  details: Schema.Record(Schema.String, Schema.Json),
});

type Noted = typeof NotedSchema.Type;

type Details = Noted['details'];

export const notes: Decider<readonly Details[], readonly Details[], Noted> = {
  initialState: [],
  evolve: (written, { details }) => [...written, details],
  decide: (written) => Result.succeed(written.map((details) => ({ type: 'noted', details }))),
  eventSchema: NotedSchema,
};
