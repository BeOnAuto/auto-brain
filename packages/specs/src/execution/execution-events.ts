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
  ...ofTheDefinition,
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

const DeliveryStartedSchema = Schema.Struct({
  type: Schema.Literal('delivery_started'),
  number: Schema.Int,
  channel: Schema.String,
  target: Schema.String,
  ...ofTheDefinition,
  ...fact,
});

export const DeliveryOutcomeSchema = Schema.Literals(['delivered', 'answered', 'failed', 'refused']);

export const DeliveryBecauseSchema = Schema.Literals([
  'status',
  'timed_out',
  'unreachable',
  'untrusted_certificate',
  'redirected',
  'not_https',
  'too_large',
  'channel_not_offered',
  'tool_error',
  'server_failure',
  'not_json',
  'answer_invalid',
  'lost',
]);

const DeliveryEndedSchema = Schema.Struct({
  type: Schema.Literal('delivery_ended'),
  number: Schema.Int,
  outcome: DeliveryOutcomeSchema,
  status: Schema.optionalKey(Schema.Int),
  because: Schema.optionalKey(DeliveryBecauseSchema),
  retry_after_ms: Schema.optionalKey(Schema.Int),
  response_bytes: Schema.optionalKey(Schema.Int),
  detail: Schema.optionalKey(Schema.String),
  duration_ms: Schema.Int,
  ...ofTheDefinition,
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
  DeliveryStartedSchema,
  DeliveryEndedSchema,
]);

export type ExecutionEvent = typeof ExecutionEventSchema.Type;

export type ExecutionStarted = Extract<ExecutionEvent, { readonly type: 'execution_started' }>;

export type ExecutionDeferred = Extract<ExecutionEvent, { readonly type: 'execution_deferred' }>;

export type ExecutionCancelRequested = Extract<ExecutionEvent, { readonly type: 'execution_cancel_requested' }>;

export type CancelRequestKind = ExecutionCancelRequested['kind'];

export type ToolCallEvent = Extract<ExecutionEvent, { readonly type: 'tool_call_started' | 'tool_call_answered' }>;

export type ToolCallStarted = Extract<ToolCallEvent, { readonly type: 'tool_call_started' }>;

export type ToolCallAnswered = Extract<ToolCallEvent, { readonly type: 'tool_call_answered' }>;

export type DeliveryEvent = Extract<ExecutionEvent, { readonly type: 'delivery_started' | 'delivery_ended' }>;

export type DeliveryStarted = Extract<DeliveryEvent, { readonly type: 'delivery_started' }>;

export type DeliveryEnded = Extract<DeliveryEvent, { readonly type: 'delivery_ended' }>;

export type DeliveryOutcome = typeof DeliveryOutcomeSchema.Type;

export type DeliveryBecause = typeof DeliveryBecauseSchema.Type;

export type ExecutionFinished = Exclude<
  ExecutionEvent,
  ExecutionStarted | ExecutionDeferred | ExecutionCancelRequested | ToolCallEvent | DeliveryEvent
>;
