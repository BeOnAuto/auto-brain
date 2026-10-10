import { factOf } from '@beonauto/operations';
import { Schema } from 'effect';

import { StrippedFormsSchema } from '../capability/stripped-forms.ts';
import { TriggerSchema } from './definition-triggers.ts';

const DefinitionContentSchema = Schema.Struct({
  source: Schema.String,
  description: Schema.optionalKey(Schema.String),
  input_schema: Schema.optionalKey(Schema.JsonObject),
  output_schema: Schema.optionalKey(Schema.JsonObject),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)),
  triggers: Schema.optionalKey(Schema.Array(TriggerSchema)),
  details: Schema.optionalKey(Schema.JsonObject),
  stripped: Schema.optionalKey(StrippedFormsSchema),
});

export type DefinitionContent = typeof DefinitionContentSchema.Type;

const SavedSchema = Schema.Struct({ content: DefinitionContentSchema });

export const DefinitionEventSchema = Schema.Union([
  factOf('definition_created', SavedSchema),
  factOf('definition_updated', SavedSchema),
  factOf('definition_retired', Schema.Struct({})),
]);

export type DefinitionEvent = typeof DefinitionEventSchema.Type;

export type DefinitionCreated = Extract<DefinitionEvent, { readonly type: 'definition_created' }>;

export type DefinitionUpdated = Extract<DefinitionEvent, { readonly type: 'definition_updated' }>;
