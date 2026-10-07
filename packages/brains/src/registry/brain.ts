import { BrainIdSchema } from '@beonauto/operations';
import { Schema } from 'effect';

export const BrainSchema = Schema.Struct({
  id: BrainIdSchema.annotate({ description: 'The id of the brain, unique within its org' }),
  name: Schema.String.annotate({ description: 'The display name of the brain' }),
  description: Schema.String.annotate({ description: 'What the brain is for, or empty' }),
  status: Schema.Literals(['active', 'retired']).annotate({ description: 'active, or retired for good' }),
  created_at: Schema.String.annotate({ description: 'When the brain was created, in ISO 8601 UTC' }),
  created_by: Schema.String.annotate({ description: 'The id of the caller who created the brain' }),
  updated_at: Schema.String.annotate({ description: 'When the brain last changed, in ISO 8601 UTC' }),
  retired_at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When the brain was retired, in ISO 8601 UTC' }),
  ),
}).annotate({ identifier: 'Brain', description: 'A brain of the org' });

export type Brain = typeof BrainSchema.Type;
