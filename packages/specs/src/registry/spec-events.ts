import { Schema } from 'effect';

const SpecContentSchema = Schema.Struct({
  source: Schema.String,
  description: Schema.optionalKey(Schema.String),
  input_schema: Schema.optionalKey(Schema.JsonObject),
  output_schema: Schema.optionalKey(Schema.JsonObject),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type SpecContent = typeof SpecContentSchema.Type;

const fact = { name: Schema.String, by: Schema.String, at: Schema.String };

const SpecCreatedSchema = Schema.Struct({
  type: Schema.Literal('spec_created'),
  ...fact,
  version: Schema.Int,
  content: SpecContentSchema,
});

const SpecUpdatedSchema = Schema.Struct({
  type: Schema.Literal('spec_updated'),
  ...fact,
  version: Schema.Int,
  content: SpecContentSchema,
});

const SpecRetiredSchema = Schema.Struct({ type: Schema.Literal('spec_retired'), ...fact });

export const SpecEventSchema = Schema.Union([SpecCreatedSchema, SpecUpdatedSchema, SpecRetiredSchema]);

export type SpecEvent = typeof SpecEventSchema.Type;

export type SpecCreated = Extract<SpecEvent, { readonly type: 'spec_created' }>;

export type SpecUpdated = Extract<SpecEvent, { readonly type: 'spec_updated' }>;

export type SpecRetired = Extract<SpecEvent, { readonly type: 'spec_retired' }>;
