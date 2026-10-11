import { ActedContextSchema, BrainIdSchema, factOf, type Decided } from '@beonauto/operations';
import { Schema } from 'effect';

const ofTheBrain = { brain: BrainIdSchema };

export const BrainEventSchema = Schema.Union([
  factOf(
    'brain_created',
    Schema.Struct({ ...ofTheBrain, name: Schema.String, description: Schema.String }),
    ActedContextSchema,
  ),
  factOf(
    'brain_updated',
    Schema.Struct({
      ...ofTheBrain,
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
    ActedContextSchema,
  ),
  factOf('brain_retired', Schema.Struct(ofTheBrain), ActedContextSchema),
]);

export type RecordedBrainEvent = typeof BrainEventSchema.Type;

export type BrainEvent = Decided<RecordedBrainEvent>;

export type BrainCreated = Extract<RecordedBrainEvent, { readonly type: 'brain_created' }>;

export type BrainUpdated = Extract<RecordedBrainEvent, { readonly type: 'brain_updated' }>;
