import { BrainIdSchema } from '@beonauto/operations';
import { Schema } from 'effect';

const fact = { brain: BrainIdSchema, by: Schema.String, at: Schema.String };

const BrainCreatedSchema = Schema.Struct({
  type: Schema.Literal('brain_created'),
  ...fact,
  name: Schema.String,
  description: Schema.String,
});

const BrainUpdatedSchema = Schema.Struct({
  type: Schema.Literal('brain_updated'),
  ...fact,
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});

const BrainRetiredSchema = Schema.Struct({ type: Schema.Literal('brain_retired'), ...fact });

export const BrainEventSchema = Schema.Union([BrainCreatedSchema, BrainUpdatedSchema, BrainRetiredSchema]);

export type BrainEvent = typeof BrainEventSchema.Type;

export type BrainCreated = Extract<BrainEvent, { readonly type: 'brain_created' }>;

export type BrainUpdated = Extract<BrainEvent, { readonly type: 'brain_updated' }>;

export type BrainRetired = Extract<BrainEvent, { readonly type: 'brain_retired' }>;
