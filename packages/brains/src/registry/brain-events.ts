import { ActedContextSchema, PlaybookIdSchema, factOf, type Decided } from '@beonauto/operations';
import { Schema } from 'effect';

const ofThePlaybook = { brain: PlaybookIdSchema };

export const PlaybookEventSchema = Schema.Union([
  factOf(
    'brain_created',
    Schema.Struct({ ...ofThePlaybook, name: Schema.String, description: Schema.String }),
    ActedContextSchema,
  ),
  factOf(
    'brain_updated',
    Schema.Struct({
      ...ofThePlaybook,
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
    ActedContextSchema,
  ),
  factOf('brain_retired', Schema.Struct(ofThePlaybook), ActedContextSchema),
]);

export type RecordedPlaybookEvent = typeof PlaybookEventSchema.Type;

export type PlaybookEvent = Decided<RecordedPlaybookEvent>;

export type PlaybookCreated = Extract<RecordedPlaybookEvent, { readonly type: 'brain_created' }>;

export type PlaybookUpdated = Extract<RecordedPlaybookEvent, { readonly type: 'brain_updated' }>;
