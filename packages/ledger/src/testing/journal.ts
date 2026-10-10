import { factOf, type Decider } from '@beonauto/operations';
import { Result, Schema } from 'effect';

import { stamped } from './happenings.ts';

const EntryWrittenSchema = factOf(
  'entry_written',
  Schema.Struct({
    at: Schema.Date,
    amount: Schema.BigInt,
    ratio: Schema.Number,
    tags: Schema.Array(Schema.String),
    memo: Schema.optionalKey(Schema.String),
    source: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  }),
);

const EntryStruckSchema = factOf('entry_struck', Schema.Struct({ reason: Schema.String }));

const JournalEventSchema = Schema.Union([EntryWrittenSchema, EntryStruckSchema]);

export type JournalEvent = typeof JournalEventSchema.Type;

const asDecided = Schema.decodeUnknownSync(Schema.toType(JournalEventSchema));

export const journal: Decider<readonly JournalEvent[], readonly JournalEvent[], JournalEvent> = {
  initialState: [],
  evolve: (written, recorded) => [...written, asDecided(recorded)],
  decide: (events) => Result.succeed(events),
  context: () => stamped,
  eventSchema: JournalEventSchema,
};
