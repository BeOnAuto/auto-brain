import type { Schema } from 'effect';

import type { ServerMessage } from '../access/caller-context.ts';
import type { CallsEndedBecause } from '../access/mcp-server-failed.ts';
import { failedOnce, failuresEnded, shownResult, toolBounds, type CallTally } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import {
  answerDocument,
  answerOf,
  errorTextForModel,
  errorTextForOperator,
  resultText,
} from '../bounds/tool-results.ts';
import type { CallOutcome } from './call-facts.ts';
import { runIdKey, toolTestIdKey } from './call-meta.ts';
import type { Forwarded } from './tool-calls.ts';

interface ModelWords {
  readonly text: string;
  readonly isError: boolean;
}

export type ReplyOutcome = CallOutcome | 'not_sent';

export interface CallReply extends ModelWords {
  readonly outcome: ReplyOutcome;
  readonly resultBytes: number | null;
  readonly durationMs: number;
  readonly serverRequestId: string | null;
  readonly answer?: Schema.Json;
}

export interface Replying {
  readonly server: string;
  readonly meta: Readonly<Record<string, string>>;
  readonly scrub: (text: string) => string;
  readonly report: (message: ServerMessage) => void;
}

export interface Tallied<A> {
  readonly tally: CallTally;
  readonly value: A;
}

const failures: ReadonlySet<string> = new Set(['server_failure', 'timed_out']);

export function failureCounted(
  tally: CallTally,
  done: Forwarded,
  replying: Replying,
): Tallied<CallsEndedBecause | undefined> {
  if (!failures.has(done.outcome)) {
    return { tally, value: undefined };
  }
  replying.report({
    server: replying.server,
    message: errorTextForOperator(done.message, replying.scrub),
    run_id: replying.meta[runIdKey] ?? null,
    tool_test_id: replying.meta[toolTestIdKey] ?? null,
  });
  const counted = failedOnce(tally);
  const because = done.failure === 'rate_limited' ? 'rate_limited' : 'failing';
  return { tally: counted, value: failuresEnded(counted) ? because : undefined };
}

export function serverFailedText(server: string, said: string): string {
  return `The MCP server ${server} failed: ${said}`;
}

export function replyOf(tally: CallTally, done: Forwarded, replying: Replying): Tallied<ModelWords> {
  if (done.result === null) {
    const said = errorTextForModel(done.message, replying.scrub);
    const text = done.outcome === 'tool_error' ? said : serverFailedText(replying.server, said);
    return { tally, value: { text, isError: true } };
  }
  const shown = shownResult(tally, replying.scrub(resultText(done.result)));
  return { tally: shown.tally, value: { text: shown.text, isError: done.outcome === 'tool_error' } };
}

function answerShown(resultJson: string, scrub: (text: string) => string) {
  const document = answerDocument(answerOf(scrub(resultJson)));
  return document === undefined || bytesOf(JSON.stringify(document)) > toolBounds.resultBytes
    ? {}
    : { answer: document };
}

export function callReplyOf(
  words: ModelWords,
  done: Forwarded,
  durationMs: number,
  scrub: (text: string) => string,
): CallReply {
  const { resultJson } = done;
  return {
    ...words,
    outcome: done.outcome,
    resultBytes: resultJson === null ? null : bytesOf(resultJson),
    durationMs,
    serverRequestId: done.serverRequestId,
    ...(resultJson === null ? {} : answerShown(resultJson, scrub)),
  };
}

export function unsentReply(text: string): CallReply {
  return { text, isError: true, outcome: 'not_sent', resultBytes: null, durationMs: 0, serverRequestId: null };
}
