import { Schema } from 'effect';

const JsonRpcIdSchema = Schema.NullOr(Schema.Union([Schema.String, Schema.Int]));

export const CallSentSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  arguments_bytes: Schema.Int,
  arguments_sha256: Schema.String,
  content_kept: Schema.Boolean,
  read_only: Schema.optionalKey(Schema.Literal(true)),
});

export const CallStartedSchema = Schema.Struct({ call_id: Schema.String, ...CallSentSchema.fields });

export const CallAnsweredSchema = Schema.Struct({
  is_error: Schema.Boolean,
  result_bytes: Schema.Int,
  result_sha256: Schema.String,
  content_kept: Schema.Boolean,
  shown_bytes: Schema.optionalKey(Schema.Int),
  duration_ms: Schema.Int,
  jsonrpc_id: JsonRpcIdSchema,
  server_request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const CallFailedBecauseSchema = Schema.Literals([
  'arguments_refused',
  'server_failure',
  'timed_out',
  'cancelled',
]);

export const CallFailedSchema = Schema.Struct({
  because: CallFailedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
  duration_ms: Schema.Int,
  jsonrpc_id: JsonRpcIdSchema,
  server_request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type CallSent = typeof CallSentSchema.Type;

export type CallStarted = typeof CallStartedSchema.Type;

export type CallAnswered = typeof CallAnsweredSchema.Type;

export type CallFailed = typeof CallFailedSchema.Type;

export type CallFailedBecause = typeof CallFailedBecauseSchema.Type;

export type CallEnded =
  | { readonly type: 'tool_call_answered'; readonly data: CallAnswered }
  | { readonly type: 'tool_call_failed'; readonly data: CallFailed };
