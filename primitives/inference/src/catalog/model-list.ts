import { Schema } from 'effect';

const Count = Schema.Int.check(Schema.isGreaterThan(0));

const ModelEntrySchema = Schema.Struct({
  id: Schema.String.annotate({
    description:
      'The model as a reasoning function names it, provider/model id, such as anthropic/claude-sonnet-4-5; an alias as its operator wrote it',
  }),
  object: Schema.Literal('model'),
  created: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      'When the provider released or added the model, in seconds since 1970; 0 when the provider does not say',
  }),
  owned_by: Schema.String.annotate({ description: 'The provider prefix that serves the model' }),
  name: Schema.optionalKey(Schema.String.annotate({ description: 'The name the provider gives the model' })),
  context_window: Schema.optionalKey(
    Count.annotate({ description: 'The most input tokens the model takes, when the provider reports it' }),
  ),
  max_tokens: Schema.optionalKey(
    Count.annotate({ description: 'The most output tokens the model writes, when the provider reports it' }),
  ),
  resolved_to: Schema.optionalKey(
    Schema.String.annotate({ description: 'For an alias, the model reference it is sent to' }),
  ),
  pattern: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: 'true when the id ends in *, which stands for any model id in its place',
    }),
  ),
});

export type ModelEntry = typeof ModelEntrySchema.Type;

const CatalogStatusSchema = Schema.Literals(['complete', 'partial']);

export const ModelListSchema = Schema.Struct({
  object: Schema.Literal('list'),
  data: Schema.Array(ModelEntrySchema),
  catalog_status: CatalogStatusSchema.annotate({
    description:
      'partial when a provider could not be asked just now, so its models are missing or as they were when last read',
  }),
  listed_at: Schema.String.annotate({
    description: 'When the oldest list of models in the answer was read from its provider, in ISO 8601',
  }),
});

export type ModelList = typeof ModelListSchema.Type;
