import { factOf } from '@beonauto/operations';
import { Schema } from 'effect';

export const reactionsStreamKind = 'reactions';

export const ReactionRefusedSchema = factOf(
  'reaction_refused',
  Schema.Struct({ count: Schema.Int, reason: Schema.String, minute: Schema.String }),
);

export type ReactionRefused = typeof ReactionRefusedSchema.Type;
