import { Schema } from 'effect';

const listedSpecFields = {
  primitive: Schema.String.annotate({ description: 'The name of the primitive the spec belongs to' }),
  name: Schema.String.annotate({
    description: 'The name of the spec, unique among the specs of its primitive in the brain and never reused',
  }),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: 'The version of the spec: 1 when created, and one more for every update that changes its document',
  }),
  status: Schema.Literals(['active', 'retired']).annotate({ description: 'active, or retired for good' }),
  media_type: Schema.String.annotate({ description: 'The media type of the spec document, set by its primitive' }),
  description: Schema.optionalKey(Schema.String.annotate({ description: 'What the spec does, as its document says' })),
  input_schema: Schema.optionalKey(
    Schema.JsonObject.annotate({ description: 'The JSON Schema of the input an execution of the spec takes' }),
  ),
  output_schema: Schema.optionalKey(
    Schema.JsonObject.annotate({ description: 'The JSON Schema of the output an execution of the spec gives' }),
  ),
  warnings: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'What the primitive found in the document that may not work everywhere, such as a schema some providers reject; the spec was accepted with them',
    }),
  ),
  created_at: Schema.String.annotate({ description: 'When the spec was created, in ISO 8601 UTC' }),
  created_by: Schema.String.annotate({ description: 'The id of the caller who created the spec' }),
  updated_at: Schema.String.annotate({ description: 'When the spec last changed, in ISO 8601 UTC' }),
  retired_at: Schema.optionalKey(Schema.String.annotate({ description: 'When the spec was retired, in ISO 8601 UTC' })),
};

export const ListedSpecSchema = Schema.Struct(listedSpecFields).annotate({
  identifier: 'ListedSpec',
  description: 'A spec of the brain, without its document',
});

export const SpecSchema = Schema.Struct({
  ...listedSpecFields,
  source: Schema.String.annotate({ description: 'The spec document' }),
}).annotate({ identifier: 'Spec', description: 'A spec of the brain, with its document' });

export type Spec = typeof SpecSchema.Type;

export type ListedSpec = typeof ListedSpecSchema.Type;

export type StoredSpec = Omit<Spec, 'primitive' | 'media_type'>;
