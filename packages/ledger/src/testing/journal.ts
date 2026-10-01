import type { Decider } from '@beonauto/operations';
import { Result, Schema } from 'effect';

const EntryWrittenSchema = Schema.Struct({
  type: Schema.Literal('entry_written'),
  at: Schema.Date,
  amount: Schema.BigInt,
  ratio: Schema.Number,
  tags: Schema.Array(Schema.String),
  memo: Schema.optionalKey(Schema.String),
  source: Schema.NullOr(Schema.Struct({ name: Schema.String })),
});

const EntryStruckSchema = Schema.Struct({ type: Schema.Literal('entry_struck'), reason: Schema.String });

const JournalEventSchema = Schema.Union([EntryWrittenSchema, EntryStruckSchema]);

export type JournalEvent = typeof JournalEventSchema.Type;

export const journal: Decider<readonly JournalEvent[], readonly JournalEvent[], JournalEvent> = {
  initialState: [],
  evolve: (written, event) => [...written, event],
  decide: (events) => Result.succeed(events),
  eventSchema: JournalEventSchema,
};
