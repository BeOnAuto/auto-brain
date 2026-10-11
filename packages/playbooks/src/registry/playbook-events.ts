import { PlaybookIdSchema } from '@beonauto/operations';
import { Schema } from 'effect';

const fact = { playbook: PlaybookIdSchema, by: Schema.String, at: Schema.String };

const PlaybookCreatedSchema = Schema.Struct({
  type: Schema.Literal('playbook_created'),
  ...fact,
  name: Schema.String,
  description: Schema.String,
});

const PlaybookUpdatedSchema = Schema.Struct({
  type: Schema.Literal('playbook_updated'),
  ...fact,
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});

const PlaybookRetiredSchema = Schema.Struct({ type: Schema.Literal('playbook_retired'), ...fact });

export const PlaybookEventSchema = Schema.Union([PlaybookCreatedSchema, PlaybookUpdatedSchema, PlaybookRetiredSchema]);

export type PlaybookEvent = typeof PlaybookEventSchema.Type;

export type PlaybookCreated = Extract<PlaybookEvent, { readonly type: 'playbook_created' }>;

export type PlaybookUpdated = Extract<PlaybookEvent, { readonly type: 'playbook_updated' }>;

export type PlaybookRetired = Extract<PlaybookEvent, { readonly type: 'playbook_retired' }>;
