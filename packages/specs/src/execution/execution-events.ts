import { Schema } from 'effect';

import { ExecutionRejectionSchema } from './execution.ts';

const fact = { by: Schema.String, at: Schema.String };

const ofTheDefinition = { primitive: Schema.String, name: Schema.String, spec_version: Schema.Int };

const Counted = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const CalledBySchema = Schema.Struct({ execution_id: Schema.String, reference: Schema.String, run: Counted });

export type CalledBy = typeof CalledBySchema.Type;

const ofTheChain = {
  depth: Schema.optionalKey(Counted),
  call_depth: Schema.optionalKey(Counted),
  called_by: Schema.optionalKey(CalledBySchema),
};

const ExecutionStartedSchema = Schema.Struct({
  type: Schema.Literal('execution_started'),
  primitive: Schema.String,
  name: Schema.String,
  spec_version: Schema.Int,
  input: Schema.Json,
  calls_tools: Schema.optionalKey(Schema.Literal(true)),
  finishes_later: Schema.optionalKey(Schema.Literal(true)),
  ...ofTheChain,
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
  ...ofTheDefinition,
  ...ofTheChain,
  ...fact,
});

const ExecutionRejectedSchema = Schema.Struct({
  type: Schema.Literal('execution_rejected'),
  rejection: ExecutionRejectionSchema,
  record: Schema.optionalKey(Schema.JsonObject),
  ...ofTheDefinition,
  ...ofTheChain,
  ...fact,
});

const ExecutionFailedSchema = Schema.Struct({
  type: Schema.Literal('execution_failed'),
  incident: Schema.optionalKey(Schema.String),
  ...ofTheDefinition,
  ...ofTheChain,
  ...fact,
});

export const CancelRequestKindSchema = Schema.Literals(['requested', 'deadline', 'parent_ended']);

const ExecutionCancelRequestedSchema = Schema.Struct({
  type: Schema.Literal('execution_cancel_requested'),
  kind: CancelRequestKindSchema,
  reason: Schema.String,
  primitive: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  spec_version: Schema.optionalKey(Schema.Int),
  ...fact,
});

const ToolCallOutcomeSchema = Schema.Literals(['result', 'tool_error', 'server_failure', 'timed_out', 'cancelled']);

const ToolCallStartedSchema = Schema.Struct({
  type: Schema.Literal('tool_call_started'),
  number: Schema.Int,
  call_id: Schema.String,
  server: Schema.String,
  tool: Schema.String,
  arguments_bytes: Schema.Int,
  arguments_sha256: Schema.String,
  arguments_json: Schema.optionalKey(Schema.String),
  ...fact,
});

const ToolCallAnsweredSchema = Schema.Struct({
  type: Schema.Literal('tool_call_answered'),
  number: Schema.Int,
  outcome: ToolCallOutcomeSchema,
  result_bytes: Schema.NullOr(Schema.Int),
  result_sha256: Schema.NullOr(Schema.String),
  duration_ms: Schema.Int,
  jsonrpc_id: Schema.NullOr(Schema.Union([Schema.String, Schema.Int])),
  server_request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  result_json: Schema.optionalKey(Schema.String),
  ...fact,
});

export const ExecutionEventSchema = Schema.Union([
  ExecutionStartedSchema,
  ExecutionDeferredSchema,
  ExecutionSucceededSchema,
  ExecutionRejectedSchema,
  ExecutionFailedSchema,
  ExecutionCancelRequestedSchema,
  ToolCallStartedSchema,
  ToolCallAnsweredSchema,
]);

export type ExecutionEvent = typeof ExecutionEventSchema.Type;

export type ExecutionStarted = Extract<ExecutionEvent, { readonly type: 'execution_started' }>;

export type ExecutionDeferred = Extract<ExecutionEvent, { readonly type: 'execution_deferred' }>;

export type ExecutionCancelRequested = Extract<ExecutionEvent, { readonly type: 'execution_cancel_requested' }>;

export type CancelRequestKind = ExecutionCancelRequested['kind'];

export type ToolCallEvent = Extract<ExecutionEvent, { readonly type: 'tool_call_started' | 'tool_call_answered' }>;

export type ToolCallStarted = Extract<ToolCallEvent, { readonly type: 'tool_call_started' }>;

export type ToolCallAnswered = Extract<ToolCallEvent, { readonly type: 'tool_call_answered' }>;

export type ExecutionFinished = Exclude<
  ExecutionEvent,
  ExecutionStarted | ExecutionDeferred | ExecutionCancelRequested | ToolCallEvent
>;
