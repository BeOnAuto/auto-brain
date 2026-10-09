import { admission } from '../bounds/call-bounds.ts';
import { callReplyOf, failureCounted, replyOf, unsentReply, type CallReply, type Replying } from './call-replies.ts';
import { callAnswered, callStarted } from './recorded-calls.ts';
import type { CallSignals, NamedOffer, RunState, RunToolsParts, ToolCallRequest } from './run-parts.ts';
import { forwarded, type Forwarded } from './tool-calls.ts';

const notRecorded = unsentReply('This call could not be recorded on its run, so it was not sent; answer without it.');

const notSent = unsentReply('The run has ended, so this call was not sent.');

function replied(state: RunState, done: Forwarded, replying: Replying, durationMs: number): CallReply {
  const failure = failureCounted(state.tally(), done, replying);
  state.tallied(failure.tally);
  if (failure.value !== undefined) {
    state.ended(failure.value);
  }
  const reply = replyOf(state.tally(), done, replying);
  state.tallied(reply.tally);
  return callReplyOf(reply.value, done, durationMs);
}

export function caller(
  parts: RunToolsParts,
  state: RunState,
  offered: NamedOffer,
): (request: ToolCallRequest, signals: CallSignals) => Promise<CallReply> {
  const { slot, reference } = offered;
  const { context, timing } = parts;
  const { scrub } = parts.secrets;
  const recording = { content: slot.settings.record_content, requestId: slot.settings.request_id !== null, scrub };
  const replying = { server: reference.server, meta: context.meta, scrub, report: parts.report };
  return async ({ callId, input }, signals) => {
    if (signals.signal.aborted) {
      return notSent;
    }
    const admitted = admission(state.tally(), { tool: offered.name, callId, input });
    state.tallied(admitted.tally);
    if (!admitted.admitted) {
      return unsentReply(admitted.refusal);
    }
    const start = callStarted({ callId, ...reference, argumentsJson: JSON.stringify(input) }, recording);
    const number = await parts.run(context.journal.started(start));
    if (number === undefined) {
      return notRecorded;
    }
    state.used(offered);
    const began = performance.now();
    const forwarding = { slot, tool: offered.tool.name, input, meta: context.meta, signal: signals.signal };
    const done = await forwarded({ ...forwarding, ...timing });
    const durationMs = Math.round(performance.now() - began);
    if (!signals.cancelled.aborted) {
      await parts.run(context.journal.answered(callAnswered({ ...done, number, durationMs }, recording)));
    }
    return replied(state, done, replying, durationMs);
  };
}
