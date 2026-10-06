import { Schema } from 'effect';

const listedDefinitionFields = {
  primitive: Schema.String.annotate({ description: 'The API type identifier of the definition' }),
  name: Schema.String.annotate({
    description: 'The definition name, unique among definitions of its type in the brain and never reused',
  }),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: 'The definition version: 1 when created, and one more for every update that changes its document',
  }),
  status: Schema.Literals(['active', 'retired']).annotate({ description: 'active, or retired for good' }),
  media_type: Schema.String.annotate({
    description: 'The media type of the definition document, set by its runtime adapter',
  }),
  description: Schema.optionalKey(
    Schema.String.annotate({ description: 'What the definition does, as its document says' }),
  ),
  input_schema: Schema.optionalKey(
    Schema.JsonObject.annotate({ description: 'The JSON Schema of the input a run takes' }),
  ),
  output_schema: Schema.optionalKey(
    Schema.JsonObject.annotate({ description: 'The JSON Schema of the result a run produces' }),
  ),
  warnings: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'What the parser found that may not work everywhere, such as a schema some providers reject; the definition was accepted with these warnings',
    }),
  ),
  created_at: Schema.String.annotate({ description: 'When the definition was created, in ISO 8601 UTC' }),
  created_by: Schema.String.annotate({ description: 'The id of the caller who created the definition' }),
  updated_at: Schema.String.annotate({ description: 'When the definition last changed, in ISO 8601 UTC' }),
  retired_at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When the definition was retired, in ISO 8601 UTC' }),
  ),
};

export const ListedDefinitionSchema = Schema.Struct(listedDefinitionFields).annotate({
  identifier: 'ListedDefinition',
  description: 'A saved definition, without its document',
});

export const DefinitionSchema = Schema.Struct({
  ...listedDefinitionFields,
  source: Schema.String.annotate({ description: 'The definition document' }),
}).annotate({ identifier: 'Definition', description: 'A saved definition, with its document' });

export type Definition = typeof DefinitionSchema.Type;

export type ReasoningFunctionDefinition = Definition & { readonly primitive: 'inference' };

export type BrainFunctionDefinition = ReasoningFunctionDefinition;

export type WorkflowDefinition = Definition & { readonly primitive: 'orchestration' };

export function isBrainFunctionDefinition(definition: Definition): definition is BrainFunctionDefinition {
  return definition.primitive === 'inference';
}

export function isWorkflowDefinition(definition: Definition): definition is WorkflowDefinition {
  return definition.primitive === 'orchestration';
}

export type ListedDefinition = typeof ListedDefinitionSchema.Type;

export type StoredDefinition = Omit<Definition, 'primitive' | 'media_type'>;
