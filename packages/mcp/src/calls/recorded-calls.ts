import { createHash } from 'node:crypto';

import type { Effect } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { bytesOf, cutAsStored } from '../bounds/text-bytes.ts';
import type { CallAnswered, CallOutcome, CallStarted } from './call-facts.ts';

export type NumberedAnswer = CallAnswered & { readonly number: number };

export type RecordedCall = (CallStarted & { readonly number: number }) | NumberedAnswer;

export interface CallJournal {
  readonly started: (fact: CallStarted) => Effect.Effect<number | undefined>;
  readonly answered: (fact: NumberedAnswer) => Effect.Effect<boolean>;
}

export interface StartedCall {
  readonly callId: string;
  readonly server: string;
  readonly tool: string;
  readonly argumentsJson: string;
}

export interface AnsweredCall {
  readonly number: number;
  readonly outcome: CallOutcome;
  readonly resultJson: string | null;
  readonly durationMs: number;
  readonly jsonrpcId: string | number | null;
  readonly serverRequestId: string | null;
}

export interface Recording {
  readonly content: boolean;
  readonly requestId: boolean;
  readonly scrub: (text: string) => string;
}

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function contentOf(name: string, json: string, { content, scrub }: Recording) {
  return content ? { [name]: cutAsStored(scrub(json), toolBounds.recordedContentBytes) } : {};
}

export function callStarted(call: StartedCall, recording: Recording): CallStarted {
  return {
    type: 'tool_call_started',
    call_id: call.callId,
    server: call.server,
    tool: call.tool,
    arguments_bytes: bytesOf(call.argumentsJson),
    arguments_sha256: digestOf(call.argumentsJson),
    ...contentOf('arguments_json', call.argumentsJson, recording),
  };
}

function resultOf(resultJson: string | null, recording: Recording) {
  return resultJson === null
    ? { result_bytes: null, result_sha256: null }
    : {
        result_bytes: bytesOf(resultJson),
        result_sha256: digestOf(resultJson),
        ...contentOf('result_json', resultJson, recording),
      };
}

export function callAnswered(call: AnsweredCall, recording: Recording): NumberedAnswer {
  return {
    type: 'tool_call_answered',
    number: call.number,
    outcome: call.outcome,
    ...resultOf(call.resultJson, recording),
    duration_ms: call.durationMs,
    jsonrpc_id: call.jsonrpcId,
    ...(recording.requestId ? { server_request_id: call.serverRequestId } : {}),
  };
}
