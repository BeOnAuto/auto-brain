import { Schema } from 'effect';

import { TriggerSchema } from './definition-triggers.ts';

const DefinitionContentSchema = Schema.Struct({
  source: Schema.String,
  description: Schema.optionalKey(Schema.String),
  input_schema: Schema.optionalKey(Schema.JsonObject),
  output_schema: Schema.optionalKey(Schema.JsonObject),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)),
  triggers: Schema.optionalKey(Schema.Array(TriggerSchema)),
  details: Schema.optionalKey(Schema.JsonObject),
});

export type DefinitionContent = typeof DefinitionContentSchema.Type;

const fact = { name: Schema.String, by: Schema.String, at: Schema.String };

const DefinitionCreatedSchema = Schema.Struct({
  type: Schema.Literal('definition_created'),
  ...fact,
  version: Schema.Int,
  content: DefinitionContentSchema,
});

const DefinitionUpdatedSchema = Schema.Struct({
  type: Schema.Literal('definition_updated'),
  ...fact,
  version: Schema.Int,
  content: DefinitionContentSchema,
});

const DefinitionRetiredSchema = Schema.Struct({ type: Schema.Literal('definition_retired'), ...fact });

export const DefinitionEventSchema = Schema.Union([
  DefinitionCreatedSchema,
  DefinitionUpdatedSchema,
  DefinitionRetiredSchema,
]);

export type DefinitionEvent = typeof DefinitionEventSchema.Type;

export type DefinitionCreated = Extract<DefinitionEvent, { readonly type: 'definition_created' }>;

export type DefinitionUpdated = Extract<DefinitionEvent, { readonly type: 'definition_updated' }>;

export type DefinitionRetired = Extract<DefinitionEvent, { readonly type: 'definition_retired' }>;
