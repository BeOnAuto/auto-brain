import { UnavailableBecauseSchema, UnavailableKindSchema } from '@beonauto/operations';
import { Schema } from 'effect';

import { mostResultBytes } from './recorded-size.ts';

const IssueSchema = Schema.Struct({
  detail: Schema.String.annotate({ description: 'What is wrong' }),
  pointer: Schema.String.annotate({ description: 'A JSON Pointer to the part of the input that is wrong' }),
});

export const ExecutionRejectionSchema = Schema.Union([
  Schema.Struct({ reason: Schema.Literal('invalid_input'), detail: Schema.String, issues: Schema.Array(IssueSchema) }),
  Schema.Struct({
    reason: Schema.Literal('unavailable'),
    detail: Schema.String,
    kind: Schema.optionalKey(
      UnavailableKindSchema.annotate({
        description:
          'What the primitive could not use, when it knows: model_not_offered for a model this server does not offer',
      }),
    ),
    because: Schema.optionalKey(
      UnavailableBecauseSchema.annotate({
        description:
          'Why, with model_not_offered: provider_not_configured when its provider is not set up on this server while others are, model_not_allowed when it is outside the models the operator allows',
      }),
    ),
  }),
  Schema.Struct({ reason: Schema.Literal('conflict'), detail: Schema.String }),
]).annotate({ description: 'Why the primitive rejected the execution' });

export type ExecutionRejection = typeof ExecutionRejectionSchema.Type;

export const ExecutionSchema = Schema.Struct({
  execution_id: Schema.String.annotate({ description: 'The id of the execution, a UUID' }),
  primitive: Schema.String.annotate({ description: 'The name of the primitive of the spec' }),
  name: Schema.String.annotate({ description: 'The name of the spec' }),
  spec_version: Schema.Int.annotate({ description: 'The version of the spec that ran' }),
  status: Schema.Literals(['started', 'succeeded', 'rejected', 'failed']).annotate({
    description:
      'started while it runs, while work it started finishes later, or when it never finished; then succeeded, rejected or failed',
  }),
  output: Schema.optionalKey(
    Schema.Json.annotate({
      description: `The output, when the execution succeeded: with the record, at most ${mostResultBytes} bytes as JSON in UTF-8`,
    }),
  ),
  rejection: Schema.optionalKey(ExecutionRejectionSchema),
  started_at: Schema.String.annotate({ description: 'When the execution started, in ISO 8601 UTC' }),
  started_by: Schema.String.annotate({ description: 'The id of the caller who started the execution' }),
  finished_at: Schema.optionalKey(
    Schema.String.annotate({ description: 'When the execution finished, in ISO 8601 UTC' }),
  ),
}).annotate({ identifier: 'Execution', description: 'One run of a spec with an input, and how it ended' });

export type Execution = typeof ExecutionSchema.Type;

export type ExecutionRecord = Omit<Execution, 'execution_id'>;

export const ExecutionDetailSchema = Schema.Struct({
  ...ExecutionSchema.fields,
  record: Schema.optionalKey(
    Schema.JsonObject.annotate({
      description:
        'What the primitive recorded of what it did: of the run that succeeded, or of the work it started that finishes later',
    }),
  ),
}).annotate({
  identifier: 'ExecutionDetail',
  description: 'One run of a spec with an input, how it ended, and what the primitive recorded of it',
});

export type ExecutionDetail = typeof ExecutionDetailSchema.Type;
