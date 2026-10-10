import { CallAnsweredSchema, CallFailedSchema, CallSentSchema, CallStartedSchema } from '@beonauto/mcp';
import { IssueSchema, factOf } from '@beonauto/operations';
import { Schema, Struct } from 'effect';

import { RunRejectionSchema } from './run.ts';

const numbered = { number: Schema.Int };

export const CancelRequestKindSchema = Schema.Literals(['requested', 'deadline', 'parent_ended']);

const sent = Struct.omit(CallSentSchema.fields, ['read_only']);

const answered = Struct.omit(CallAnsweredSchema.fields, ['is_error', 'shown_bytes']);

export const DeliveryFailedBecauseSchema = Schema.Literals([
  'tool_error',
  'arguments_refused',
  'server_failure',
  'timed_out',
  'tool_not_offered',
  'lost',
]);

export const DeliveryRefusedBecauseSchema = Schema.Literals(['too_large', 'unworkable']);

const DeliveredAsSchema = Schema.Struct({ conversation: Schema.String, id: Schema.String });

const RepliesInSchema = Schema.Struct({ server: Schema.String, tool: Schema.String, key: Schema.String });

const DeliveryStartedSchema = Schema.Struct({
  ...numbered,
  target: Schema.String,
  server: sent.server,
  tool: sent.tool,
  arguments_bytes: Schema.optionalKey(sent.arguments_bytes),
  arguments_sha256: Schema.optionalKey(sent.arguments_sha256),
  content_kept: Schema.optionalKey(sent.content_kept),
});

const DeliverySucceededSchema = Schema.Struct({
  ...numbered,
  ...answered,
  delivered_as: Schema.optionalKey(DeliveredAsSchema),
  replies_in: Schema.optionalKey(RepliesInSchema),
});

const DeliveryFailedSchema = Schema.Struct({
  ...numbered,
  because: DeliveryFailedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
  retry_after_ms: Schema.optionalKey(Schema.Int),
  result_bytes: Schema.optionalKey(answered.result_bytes),
  result_sha256: Schema.optionalKey(answered.result_sha256),
  content_kept: Schema.optionalKey(answered.content_kept),
  duration_ms: Schema.Int,
  jsonrpc_id: Schema.optionalKey(answered.jsonrpc_id),
  server_request_id: answered.server_request_id,
});

const DeliveryRefusedSchema = Schema.Struct({
  ...numbered,
  because: DeliveryRefusedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
  duration_ms: Schema.Int,
});

const ReplyIdentitySchema = Schema.Struct({ id: Schema.String, sender: Schema.String });

const ofTheReading = { server: Schema.String, tool: Schema.String, reply: ReplyIdentitySchema };

export const ReplyRefusalSchema = Schema.Literals(['not_an_answer', 'invalid', 'too_long', 'ambiguous']);

export const RunEventSchema = Schema.Union([
  factOf(
    'run_started',
    Schema.Struct({
      input: Schema.Json,
      calls_tools: Schema.optionalKey(Schema.Literal(true)),
      finishes_later: Schema.optionalKey(Schema.Literal(true)),
    }),
  ),
  factOf('run_deferred', Schema.Struct({ record: Schema.JsonObject })),
  factOf('run_succeeded', Schema.Struct({ output: Schema.Json, record: Schema.JsonObject })),
  factOf(
    'run_rejected',
    Schema.Struct({ rejection: RunRejectionSchema, record: Schema.optionalKey(Schema.JsonObject) }),
  ),
  factOf('run_failed', Schema.Struct({ incident: Schema.optionalKey(Schema.String) })),
  factOf('run_cancel_requested', Schema.Struct({ kind: CancelRequestKindSchema, reason: Schema.String })),
  factOf('tool_call_started', Schema.Struct({ ...numbered, ...CallStartedSchema.fields })),
  factOf('tool_call_answered', Schema.Struct({ ...numbered, ...CallAnsweredSchema.fields })),
  factOf('tool_call_failed', Schema.Struct({ ...numbered, ...CallFailedSchema.fields })),
  factOf('delivery_started', DeliveryStartedSchema),
  factOf('delivery_succeeded', DeliverySucceededSchema),
  factOf('delivery_failed', DeliveryFailedSchema),
  factOf('delivery_refused', DeliveryRefusedSchema),
  factOf('reply_taken', Schema.Struct({ ...ofTheReading, answer: Schema.Json })),
  factOf(
    'reply_refused',
    Schema.Struct({
      ...ofTheReading,
      because: ReplyRefusalSchema,
      issues: Schema.optionalKey(Schema.Array(IssueSchema)),
      told: Schema.Boolean,
    }),
  ),
]);

export type RunEvent = typeof RunEventSchema.Type;

type FactNamed<Type extends RunEvent['type']> = Extract<RunEvent, { readonly type: Type }>;

export type RunStarted = FactNamed<'run_started'>;

export type RunDeferred = FactNamed<'run_deferred'>;

export type RunCancelRequested = FactNamed<'run_cancel_requested'>;

export type CancelRequestKind = RunCancelRequested['data']['kind'];

export type ToolCallEvent = FactNamed<'tool_call_started' | 'tool_call_answered' | 'tool_call_failed'>;

export type ToolCallStarted = FactNamed<'tool_call_started'>;

export type ToolCallEnded = FactNamed<'tool_call_answered' | 'tool_call_failed'>;

export type DeliveryEvent = FactNamed<
  'delivery_started' | 'delivery_succeeded' | 'delivery_failed' | 'delivery_refused'
>;

export type DeliveryStarted = FactNamed<'delivery_started'>;

export type DeliveryEnded = FactNamed<'delivery_succeeded' | 'delivery_failed' | 'delivery_refused'>;

export type DeliveredAs = typeof DeliveredAsSchema.Type;

export type RepliesIn = typeof RepliesInSchema.Type;

export type ReplyIdentity = typeof ReplyIdentitySchema.Type;

export type ReplyEvent = FactNamed<'reply_taken' | 'reply_refused'>;

export type ReplyTaken = FactNamed<'reply_taken'>;

export type ReplyRefused = FactNamed<'reply_refused'>;

export type ReplyRefusal = typeof ReplyRefusalSchema.Type;

export type DeliveryFailedBecause = typeof DeliveryFailedBecauseSchema.Type;

export type DeliveryRefusedBecause = typeof DeliveryRefusedBecauseSchema.Type;

export type RunFinished = FactNamed<'run_succeeded' | 'run_rejected' | 'run_failed'>;
