import { admission } from '../bounds/call-bounds.ts';
import type { CallStarted } from './call-facts.ts';
import { callReplyOf, failureCounted, replyOf, unsentReply, type CallReply, type Replying } from './call-replies.ts';
import { callAnswered, callStarted, type NumberedAnswer, type Recording } from './recorded-calls.ts';
import type { CallSignals, NamedOffer, RunState, RunToolsParts, ToolCallRequest } from './run-parts.ts';
import { forwarded, type Forwarded, type Forwarding } from './tool-calls.ts';

const notRecorded = unsentReply('This call could not be recorded on its run, so it was not sent; answer without it.');

const notSent = unsentReply('The run has ended, so this call was not sent.');

export interface CallJournalling {
  readonly callId: string;
  readonly started: (fact: CallStarted) => Promise<number | undefined>;
  readonly answered: (fact: NumberedAnswer) => Promise<void>;
}

interface SentCall {
  readonly sent: true;
  readonly done: Forwarded;
  readonly durationMs: number;
}

export type JournalledCall = SentCall | { readonly sent: false };

const unsent: JournalledCall = { sent: false };

async function sentCall(forwarding: Forwarding): Promise<SentCall> {
  const began = performance.now();
  const done = await forwarded(forwarding);
  return { sent: true, done, durationMs: Math.round(performance.now() - began) };
}

function startOf(forwarding: Forwarding, recording: Recording, callId: string): CallStarted {
  const { slot, tool, input } = forwarding;
  return callStarted({ callId, server: slot.settings.name, tool, argumentsJson: JSON.stringify(input) }, recording);
}

export async function journalledCall(
  forwarding: Forwarding,
  recording: Recording,
  journalling?: CallJournalling,
): Promise<JournalledCall> {
  if (journalling === undefined) {
    return sentCall(forwarding);
  }
  const number = await journalling.started(startOf(forwarding, recording, journalling.callId));
  if (number === undefined) {
    return unsent;
  }
  const sent = await sentCall(forwarding);
  await journalling.answered(callAnswered({ ...sent.done, number, durationMs: sent.durationMs }, recording));
  return sent;
}

function replied(state: RunState, done: Forwarded, replying: Replying, durationMs: number): CallReply {
  const failure = failureCounted(state.tally(), done, replying);
  state.tallied(failure.tally);
  if (failure.value !== undefined) {
    state.ended(failure.value);
  }
  const reply = replyOf(state.tally(), done, replying);
  state.tallied(reply.tally);
  return callReplyOf(reply.value, done, durationMs, replying.scrub);
}

export function caller(
  parts: RunToolsParts,
  state: RunState,
  offered: NamedOffer,
): (request: ToolCallRequest, signals: CallSignals) => Promise<CallReply> {
  const { slot } = offered;
  const { context, timing } = parts;
  const { scrub } = parts.secrets;
  const recording = { content: slot.settings.record_content, requestId: slot.settings.request_id !== null, scrub };
  const replying = { server: offered.reference.server, meta: context.meta, scrub, report: parts.report };
  return async ({ callId, input }, signals) => {
    if (signals.signal.aborted) {
      return notSent;
    }
    const admitted = admission(state.tally(), { tool: offered.name, callId, input });
    state.tallied(admitted.tally);
    if (!admitted.admitted) {
      return unsentReply(admitted.refusal);
    }
    const forwarding = { slot, tool: offered.tool.name, input, meta: context.meta, signal: signals.signal };
    const journey = await journalledCall({ ...forwarding, ...timing }, recording, {
      callId,
      started: async (fact) => {
        const number = await parts.run(context.journal.started(fact));
        if (number !== undefined) {
          state.used(offered);
        }
        return number;
      },
      answered: async (fact) => {
        if (!signals.cancelled.aborted) {
          await parts.run(context.journal.answered(fact));
        }
      },
    });
    return journey.sent ? replied(state, journey.done, replying, journey.durationMs) : notRecorded;
  };
}
