import type { ServerMessage } from '../access/caller-context.ts';
import type { CallsEndedBecause } from '../access/mcp-server-failed.ts';
import { failedOnce, failuresEnded, shownResult, type CallTally } from '../bounds/call-bounds.ts';
import { bytesOf } from '../bounds/text-bytes.ts';
import { errorTextForModel, errorTextForOperator, resultText, type ToolAnswer } from '../bounds/tool-results.ts';
import { runIdKey, toolTestIdKey } from './call-meta.ts';
import type { Delivered, Forwarded, ForwardedOutcome } from './tool-calls.ts';

interface ModelWords {
  readonly text: string;
  readonly isError: boolean;
  readonly shownBytes?: number;
}

export type ReplyOutcome = 'result' | 'tool_error' | 'server_failure' | 'timed_out' | 'cancelled' | 'not_sent';

export interface CallReply extends ModelWords {
  readonly outcome: ReplyOutcome;
  readonly resultBytes: number | null;
  readonly durationMs: number;
  readonly serverRequestId: string | null;
  readonly scrubbedResult?: ToolAnswer;
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

export function replyOf(done: Delivered, replying: Pick<Replying, 'server' | 'scrub'>, room?: number): ModelWords {
  if (done.resultJson === null) {
    const said = errorTextForModel(done.message, replying.scrub);
    const text = done.outcome === 'arguments_refused' ? said : serverFailedText(replying.server, said);
    return { text, isError: true };
  }
  return { ...shownResult(resultText(done.scrubbed), room), isError: done.outcome === 'tool_error' };
}

function replyOutcomeOf(outcome: ForwardedOutcome): ReplyOutcome {
  return outcome === 'arguments_refused' ? 'tool_error' : outcome;
}

export function callReplyOf(words: ModelWords, done: Forwarded, durationMs: number): CallReply {
  return {
    ...words,
    outcome: replyOutcomeOf(done.outcome),
    resultBytes: done.resultJson === null ? null : bytesOf(done.resultJson),
    durationMs,
    serverRequestId: done.serverRequestId,
  };
}

export function unsentReply(text: string): CallReply {
  return { text, isError: true, outcome: 'not_sent', resultBytes: null, durationMs: 0, serverRequestId: null };
}
