import { Schema } from 'effect';

export const reactionsStreamKind = 'reactions';

export const ReactionRefusedSchema = Schema.Struct({
  type: Schema.Literal('reaction_refused'),
  workflow: Schema.String,
  count: Schema.Int,
  reason: Schema.String,
  minute: Schema.String,
  at: Schema.String,
});

export type ReactionRefused = typeof ReactionRefusedSchema.Type;
