import type { Context } from '@beonauto/operations';
import { Struct } from 'effect';

import type { CallAnswered } from '../calls/call-facts.ts';
import type { StartedFields } from '../calls/recorded-calls.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { CalledOnce } from '../one-call/called-once.ts';
import {
  ConversationCallEventSchema,
  type ConversationCallEvent,
  type ReadingFailedBecause,
  type ReadingRecorded,
  type TellingEnded,
  type TellingStarted,
} from './conversation-call-events.ts';
import { ownCallDecider, type OwnCall } from './own-call-decider.ts';

export const conversationCallDecider = ownCallDecider<ConversationCallEvent>({
  first: ['telling_started', 'replies_read', 'reading_failed'],
  after: { telling_started: ['telling_succeeded', 'telling_failed'] },
  eventSchema: ConversationCallEventSchema,
  outOfTurn:
    'A call of the brain in a conversation records the start of a telling once and then how it ended once, or a read once, so this is not recorded',
});

export type Recorded = Pick<Context, 'by' | 'at'>;

export type ConversationCall = OwnCall<ConversationCallEvent>;

export interface Telling {
  readonly callId: string;
  readonly runId: string;
}

function answeredOf(answered: CallAnswered) {
  return Struct.omit(answered, ['is_error', 'shown_bytes']);
}

function endOf(end: CalledOnce | undefined) {
  if (end?.kind !== 'answered') {
    return {};
  }
  return 'failed' in end ? end.failed : answeredOf(end.answered);
}

function detailOf(detail: string | undefined) {
  return detail === undefined || detail === '' ? {} : { detail };
}

export function tellingStartedOf(
  { callId, runId }: Telling,
  start: StartedFields,
  recorded: Recorded,
): ConversationCall {
  const event: TellingStarted = { type: 'telling_started', data: { call_id: callId, ...start } };
  return { event, context: { ...recorded, runId } };
}

function tellingEnd(callId: string, end: CalledOnce): TellingEnded {
  if (end.kind === 'unopened') {
    const because = end.refused === 'tool_not_offered' ? 'tool_not_offered' : 'server_failure';
    return { type: 'telling_failed', data: { call_id: callId, because, ...detailOf(end.detail) } };
  }
  if (end.outcome === 'result') {
    return { type: 'telling_succeeded', data: { call_id: callId, ...answeredOf(end.answered) } };
  }
  return {
    type: 'telling_failed',
    data: { call_id: callId, ...endOf(end), because: end.outcome, ...detailOf(end.detail) },
  };
}

export function tellingEndedOf(telling: Telling, end: CalledOnce, recorded: Recorded): ConversationCall {
  return { event: tellingEnd(telling.callId, end), context: { ...recorded, runId: telling.runId } };
}

interface ReadPlace {
  readonly callId: string;
  readonly start: StartedFields | ToolReference;
  readonly conversation: string;
  readonly since: string | null;
}

export interface RepliesRead extends ReadPlace {
  readonly answered: CallAnswered;
  readonly replies: number;
  readonly taken: number;
  readonly refused: number;
}

export interface ReadingFailed extends ReadPlace {
  readonly because: ReadingFailedBecause;
  readonly end?: CalledOnce;
  readonly detail?: string;
  readonly retryAfterMs: number | null;
}

function argumentsOf(start: StartedFields | ToolReference) {
  return 'arguments_bytes' in start
    ? { arguments_bytes: start.arguments_bytes, arguments_sha256: start.arguments_sha256 }
    : {};
}

function ofTheRead({ callId, start, conversation, since }: ReadPlace) {
  return { call_id: callId, server: start.server, tool: start.tool, conversation, since, ...argumentsOf(start) };
}

export function repliesReadOf(read: RepliesRead, recorded: Recorded): ConversationCall {
  const { replies, taken, refused } = read;
  const event: ReadingRecorded = {
    type: 'replies_read',
    data: { ...ofTheRead(read), ...answeredOf(read.answered), replies, taken, refused },
  };
  return { event, context: recorded };
}

export function readingFailedOf(failed: ReadingFailed, recorded: Recorded): ConversationCall {
  const event: ReadingRecorded = {
    type: 'reading_failed',
    data: {
      ...ofTheRead(failed),
      ...endOf(failed.end),
      because: failed.because,
      ...detailOf(failed.detail),
      ...(failed.retryAfterMs === null ? {} : { retry_after_ms: failed.retryAfterMs }),
    },
  };
  return { event, context: recorded };
}
