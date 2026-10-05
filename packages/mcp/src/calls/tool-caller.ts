import { admission } from '../bounds/call-bounds.ts';
import { failureCounted, replyOf, type Replying, type ToolReply } from './call-replies.ts';
import { callAnswered, callStarted } from './recorded-calls.ts';
import type { CallSignals, NamedOffer, RunState, RunToolsParts, ToolCallRequest } from './run-parts.ts';
import { forwarded, type Forwarded } from './tool-calls.ts';

const notRecorded: ToolReply = {
  text: 'This call could not be recorded on its run, so it was not sent; answer without it.',
  isError: true,
};

const notSent: ToolReply = { text: 'The run has ended, so this call was not sent.', isError: true };

function replied(state: RunState, done: Forwarded, replying: Replying): ToolReply {
  const failure = failureCounted(state.tally(), done, replying);
  state.tallied(failure.tally);
  if (failure.value !== undefined) {
    state.ended(failure.value);
  }
  const reply = replyOf(state.tally(), done, replying);
  state.tallied(reply.tally);
  return reply.value;
}

export function caller(
  parts: RunToolsParts,
  state: RunState,
  offered: NamedOffer,
): (request: ToolCallRequest, signals: CallSignals) => Promise<ToolReply> {
  const { slot, reference } = offered;
  const { scrub } = parts.secrets;
  const recording = { content: slot.settings.record_content, requestId: slot.settings.request_id !== null, scrub };
  const replying = { server: reference.server, executionId: parts.execution.id, scrub, report: parts.report };
  return async ({ callId, input }, signals) => {
    if (signals.signal.aborted) {
      return notSent;
    }
    const admitted = admission(state.tally(), { tool: offered.name, callId, input });
    state.tallied(admitted.tally);
    if (!admitted.admitted) {
      return { text: admitted.refusal, isError: true };
    }
    const number = state.numbered();
    const start = callStarted({ number, callId, ...reference, argumentsJson: JSON.stringify(input) }, recording);
    if (!(await parts.run(parts.execution.journal.record(start)))) {
      return notRecorded;
    }
    state.used(reference);
    const began = performance.now();
    const { execution, timing } = parts;
    const forwarding = { slot, tool: offered.tool.name, input, executionId: execution.id, signal: signals.signal };
    const done = await forwarded({ ...forwarding, ...timing });
    if (!signals.cancelled.aborted) {
      const answer = { ...done, number, durationMs: Math.round(performance.now() - began) };
      await parts.run(execution.journal.record(callAnswered(answer, recording)));
    }
    return replied(state, done, replying);
  };
}
