import { Schema } from 'effect';

import { ExecutionRejectionSchema } from './execution.ts';

const fact = { by: Schema.String, at: Schema.String };

const ExecutionStartedSchema = Schema.Struct({
  type: Schema.Literal('execution_started'),
  primitive: Schema.String,
  name: Schema.String,
  spec_version: Schema.Int,
  input: Schema.Json,
  ...fact,
});

const ExecutionDeferredSchema = Schema.Struct({
  type: Schema.Literal('execution_deferred'),
  record: Schema.JsonObject,
  ...fact,
});

const ExecutionSucceededSchema = Schema.Struct({
  type: Schema.Literal('execution_succeeded'),
  output: Schema.Json,
  record: Schema.JsonObject,
  ...fact,
});

const ExecutionRejectedSchema = Schema.Struct({
  type: Schema.Literal('execution_rejected'),
  rejection: ExecutionRejectionSchema,
  ...fact,
});

const ExecutionFailedSchema = Schema.Struct({ type: Schema.Literal('execution_failed'), ...fact });

export const ExecutionEventSchema = Schema.Union([
  ExecutionStartedSchema,
  ExecutionDeferredSchema,
  ExecutionSucceededSchema,
  ExecutionRejectedSchema,
  ExecutionFailedSchema,
]);

export type ExecutionEvent = typeof ExecutionEventSchema.Type;

export type ExecutionStarted = Extract<ExecutionEvent, { readonly type: 'execution_started' }>;

export type ExecutionDeferred = Extract<ExecutionEvent, { readonly type: 'execution_deferred' }>;

export type ExecutionFinished = Exclude<ExecutionEvent, ExecutionStarted | ExecutionDeferred>;
