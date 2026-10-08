import { Schema } from 'effect';

import { CallOutcomeSchema } from '../calls/call-facts.ts';

export const conversationCallsKind = 'conversation-calls';

const ofTheBrain = { by: Schema.String, at: Schema.String };

const theTool = { server: Schema.String, tool: Schema.String };

const startedFields = {
  arguments_bytes: Schema.optionalKey(Schema.Int),
  arguments_sha256: Schema.optionalKey(Schema.String),
  arguments_json: Schema.optionalKey(Schema.String),
};

const answeredFields = {
  result_bytes: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  result_sha256: Schema.optionalKey(Schema.NullOr(Schema.String)),
  result_json: Schema.optionalKey(Schema.String),
  duration_ms: Schema.optionalKey(Schema.Int),
  jsonrpc_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Int]))),
  server_request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
};

const TellingStartedSchema = Schema.Struct({
  type: Schema.Literal('telling_started'),
  call_id: Schema.String,
  execution_id: Schema.String,
  ...theTool,
  ...startedFields,
  ...ofTheBrain,
});

const TellingOutcomeSchema = Schema.Union([CallOutcomeSchema, Schema.Literal('tool_not_offered')]);

const TellingEndedSchema = Schema.Struct({
  type: Schema.Literal('telling_ended'),
  call_id: Schema.String,
  outcome: TellingOutcomeSchema,
  ...answeredFields,
  ...ofTheBrain,
});

const ReadOutcomeSchema = Schema.Literals([
  'result',
  'tool_error',
  'server_failure',
  'timed_out',
  'unreadable',
  'too_large',
  'tool_not_offered',
]);

const RepliesReadSchema = Schema.Struct({
  type: Schema.Literal('replies_read'),
  call_id: Schema.String,
  ...theTool,
  ...startedFields,
  ...answeredFields,
  outcome: ReadOutcomeSchema,
  conversation: Schema.String,
  since: Schema.NullOr(Schema.String),
  replies: Schema.Int,
  taken: Schema.Int,
  refused: Schema.Int,
  retry_after_ms: Schema.optionalKey(Schema.Int),
  ...ofTheBrain,
});

export const ConversationCallEventSchema = Schema.Union([TellingStartedSchema, TellingEndedSchema, RepliesReadSchema]);

export type ConversationCallEvent = typeof ConversationCallEventSchema.Type;

export type TellingStarted = Extract<ConversationCallEvent, { readonly type: 'telling_started' }>;

export type TellingEnded = Extract<ConversationCallEvent, { readonly type: 'telling_ended' }>;

export type RepliesRead = Extract<ConversationCallEvent, { readonly type: 'replies_read' }>;

export type TellingOutcome = typeof TellingOutcomeSchema.Type;

export type ReadOutcome = typeof ReadOutcomeSchema.Type;

export function conversationCallStreamOf(callId: string): string {
  return `${conversationCallsKind}/${callId}`;
}
