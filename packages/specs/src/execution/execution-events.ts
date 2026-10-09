import { CallAnsweredSchema, CallStartedSchema } from '@beonauto/mcp';
import { IssueSchema } from '@beonauto/operations';
import { Schema } from 'effect';

import { StartingTriggerSchema } from '../registry/spec-triggers.ts';
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
  trigger: Schema.optionalKey(StartingTriggerSchema),
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

const { type: callStarted, ...startedFields } = CallStartedSchema.fields;

const ToolCallStartedSchema = Schema.Struct({ type: callStarted, number: Schema.Int, ...startedFields, ...fact });

const { type: callAnswered, ...answeredFields } = CallAnsweredSchema.fields;

const ToolCallAnsweredSchema = Schema.Struct({ type: callAnswered, number: Schema.Int, ...answeredFields, ...fact });

const DeliveryStartedSchema = Schema.Struct({
  type: Schema.Literal('delivery_started'),
  number: Schema.Int,
  target: Schema.String,
  server: startedFields.server,
  tool: startedFields.tool,
  arguments_bytes: Schema.optionalKey(startedFields.arguments_bytes),
  arguments_sha256: Schema.optionalKey(startedFields.arguments_sha256),
  arguments_json: startedFields.arguments_json,
  ...ofTheDefinition,
  ...fact,
});

export const DeliveryOutcomeSchema = Schema.Literals(['delivered', 'failed', 'refused']);

export const DeliveryBecauseSchema = Schema.Literals([
  'timed_out',
  'too_large',
  'unworkable',
  'tool_not_offered',
  'tool_error',
  'server_failure',
  'lost',
]);

const DeliveredAsSchema = Schema.Struct({ conversation: Schema.String, id: Schema.String });

const RepliesInSchema = Schema.Struct({ server: Schema.String, tool: Schema.String, key: Schema.String });

const DeliveryEndedSchema = Schema.Struct({
  type: Schema.Literal('delivery_ended'),
  number: Schema.Int,
  outcome: DeliveryOutcomeSchema,
  because: Schema.optionalKey(DeliveryBecauseSchema),
  retry_after_ms: Schema.optionalKey(Schema.Int),
  detail: Schema.optionalKey(Schema.String),
  result_bytes: Schema.optionalKey(answeredFields.result_bytes),
  result_sha256: Schema.optionalKey(answeredFields.result_sha256),
  result_json: answeredFields.result_json,
  jsonrpc_id: Schema.optionalKey(answeredFields.jsonrpc_id),
  server_request_id: answeredFields.server_request_id,
  duration_ms: Schema.Int,
  delivered_as: Schema.optionalKey(DeliveredAsSchema),
  replies_in: Schema.optionalKey(RepliesInSchema),
  ...ofTheDefinition,
  ...fact,
});

const ReplyIdentitySchema = Schema.Struct({ id: Schema.String, sender: Schema.String });

const ofTheReading = { server: Schema.String, tool: Schema.String, reply: ReplyIdentitySchema };

const ReplyTakenSchema = Schema.Struct({
  type: Schema.Literal('reply_taken'),
  ...ofTheReading,
  answer: Schema.Json,
  ...ofTheDefinition,
  ...fact,
});

export const ReplyRefusalSchema = Schema.Literals(['not_an_answer', 'invalid', 'too_long', 'ambiguous']);

const ReplyRefusedSchema = Schema.Struct({
  type: Schema.Literal('reply_refused'),
  ...ofTheReading,
  because: ReplyRefusalSchema,
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  told: Schema.Boolean,
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
  ReplyTakenSchema,
  ReplyRefusedSchema,
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

export type DeliveredAs = typeof DeliveredAsSchema.Type;

export type RepliesIn = typeof RepliesInSchema.Type;

export type ReplyIdentity = typeof ReplyIdentitySchema.Type;

export type ReplyEvent = Extract<ExecutionEvent, { readonly type: 'reply_taken' | 'reply_refused' }>;

export type ReplyTaken = Extract<ReplyEvent, { readonly type: 'reply_taken' }>;

export type ReplyRefused = Extract<ReplyEvent, { readonly type: 'reply_refused' }>;

export type ReplyRefusal = typeof ReplyRefusalSchema.Type;

export type DeliveryOutcome = typeof DeliveryOutcomeSchema.Type;

export type DeliveryBecause = typeof DeliveryBecauseSchema.Type;

export type ExecutionFinished = Exclude<
  ExecutionEvent,
  ExecutionStarted | ExecutionDeferred | ExecutionCancelRequested | ToolCallEvent | DeliveryEvent | ReplyEvent
>;
