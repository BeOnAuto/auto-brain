import { createHash } from 'node:crypto';

import type { Effect } from 'effect';

import { toolBounds } from '../bounds/call-bounds.ts';
import { bytesOf, cutAsStored } from '../bounds/text-bytes.ts';

export type CallOutcome = 'result' | 'tool_error' | 'server_failure' | 'timed_out' | 'cancelled';

export interface CallStarted {
  readonly type: 'tool_call_started';
  readonly call_id: string;
  readonly server: string;
  readonly tool: string;
  readonly arguments_bytes: number;
  readonly arguments_sha256: string;
  readonly arguments_json?: string;
}

export interface CallAnswered {
  readonly type: 'tool_call_answered';
  readonly number: number;
  readonly outcome: CallOutcome;
  readonly result_bytes: number | null;
  readonly result_sha256: string | null;
  readonly duration_ms: number;
  readonly jsonrpc_id: string | number | null;
  readonly server_request_id?: string | null;
  readonly result_json?: string;
}

export type RecordedCall = (CallStarted & { readonly number: number }) | CallAnswered;

export interface CallJournal {
  readonly started: (fact: CallStarted) => Effect.Effect<number | undefined>;
  readonly answered: (fact: CallAnswered) => Effect.Effect<boolean>;
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

export function callAnswered(call: AnsweredCall, recording: Recording): CallAnswered {
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
