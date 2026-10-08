import type { ServerMessage } from '../access/caller-context.ts';
import type { CallsEndedBecause } from '../access/mcp-server-failed.ts';
import { failedOnce, failuresEnded, shownResult, type CallTally } from '../bounds/call-bounds.ts';
import { errorTextForModel, errorTextForOperator, resultText } from '../bounds/result-text.ts';
import type { Forwarded } from './tool-calls.ts';

export interface ToolReply {
  readonly text: string;
  readonly isError: boolean;
}

export interface Replying {
  readonly server: string;
  readonly executionId: string;
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
    execution_id: replying.executionId,
  });
  const counted = failedOnce(tally);
  const because = done.failure === 'rate_limited' ? 'rate_limited' : 'failing';
  return { tally: counted, value: failuresEnded(counted) ? because : undefined };
}

export function replyOf(tally: CallTally, done: Forwarded, replying: Replying): Tallied<ToolReply> {
  if (done.result === null) {
    const said = errorTextForModel(done.message, replying.scrub);
    const text = done.outcome === 'tool_error' ? said : `The MCP server ${replying.server} failed: ${said}`;
    return { tally, value: { text, isError: true } };
  }
  const shown = shownResult(tally, replying.scrub(resultText(done.result)));
  return { tally: shown.tally, value: { text: shown.text, isError: done.outcome === 'tool_error' } };
}
