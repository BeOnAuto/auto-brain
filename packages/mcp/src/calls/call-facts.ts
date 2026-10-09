import { Schema } from 'effect';

export const CallOutcomeSchema = Schema.Literals(['result', 'tool_error', 'server_failure', 'timed_out', 'cancelled']);

export const CallStartedSchema = Schema.Struct({
  type: Schema.Literal('tool_call_started'),
  call_id: Schema.String,
  server: Schema.String,
  tool: Schema.String,
  arguments_bytes: Schema.Int,
  arguments_sha256: Schema.String,
  arguments_json: Schema.optionalKey(Schema.String),
});

export const CallAnsweredSchema = Schema.Struct({
  type: Schema.Literal('tool_call_answered'),
  outcome: CallOutcomeSchema,
  result_bytes: Schema.NullOr(Schema.Int),
  result_sha256: Schema.NullOr(Schema.String),
  duration_ms: Schema.Int,
  jsonrpc_id: Schema.NullOr(Schema.Union([Schema.String, Schema.Int])),
  server_request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  result_json: Schema.optionalKey(Schema.String),
});

export type CallOutcome = typeof CallOutcomeSchema.Type;

export type CallStarted = typeof CallStartedSchema.Type;

export type CallAnswered = typeof CallAnsweredSchema.Type;
