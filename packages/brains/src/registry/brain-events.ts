import { BrainIdSchema, factOf } from '@beonauto/operations';
import { Schema } from 'effect';

const ofTheBrain = { brain: BrainIdSchema };

export const BrainEventSchema = Schema.Union([
  factOf('brain_created', Schema.Struct({ ...ofTheBrain, name: Schema.String, description: Schema.String })),
  factOf(
    'brain_updated',
    Schema.Struct({
      ...ofTheBrain,
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
  ),
  factOf('brain_retired', Schema.Struct(ofTheBrain)),
]);

export type BrainEvent = typeof BrainEventSchema.Type;

export type BrainCreated = Extract<BrainEvent, { readonly type: 'brain_created' }>;

export type BrainUpdated = Extract<BrainEvent, { readonly type: 'brain_updated' }>;
