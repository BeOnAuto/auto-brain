import type { StartedFields } from '../calls/recorded-calls.ts';
import type { AnsweredOnce } from '../delivery/delivery-bounds.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import {
  ConversationCallEventSchema,
  type ConversationCallEvent,
  type ReadOutcome,
  type RepliesRead,
  type TellingEnded,
  type TellingStarted,
} from './conversation-call-events.ts';
import { ownCallDecider } from './own-call-decider.ts';

export const conversationCallDecider = ownCallDecider<ConversationCallEvent>({
  first: ['telling_started', 'replies_read'],
  after: { telling_started: 'telling_ended' },
  eventSchema: ConversationCallEventSchema,
  outOfTurn:
    'A call of the brain in a conversation records the start of a telling once and then its end once, or a read once, so this is not recorded',
});

export interface Recorded {
  readonly by: string;
  readonly at: string;
}

export type CallStart = StartedFields | ToolReference;

export type CallEnd = AnsweredOnce | { readonly kind: 'not_offered' };

function answeredOf(end: CallEnd) {
  return end.kind === 'answered' ? { ...end.fields, duration_ms: end.durationMs } : {};
}

export interface Telling {
  readonly callId: string;
  readonly executionId: string;
}

export function tellingStartedOf(
  { callId, executionId }: Telling,
  start: CallStart,
  recorded: Recorded,
): TellingStarted {
  return { type: 'telling_started', call_id: callId, execution_id: executionId, ...start, ...recorded };
}

export function tellingEndedOf(callId: string, end: CallEnd, recorded: Recorded): TellingEnded {
  return {
    type: 'telling_ended',
    call_id: callId,
    outcome: end.kind === 'answered' ? end.outcome : 'tool_not_offered',
    ...answeredOf(end),
    ...recorded,
  };
}

export interface Reading {
  readonly callId: string;
  readonly start: CallStart;
  readonly end: CallEnd;
  readonly outcome: ReadOutcome;
  readonly conversation: string;
  readonly since: string | null;
  readonly replies: number;
  readonly taken: number;
  readonly refused: number;
  readonly retryAfterMs: number | null;
}

export function repliesReadOf(reading: Reading, recorded: Recorded): RepliesRead {
  const { callId, start, end, outcome, conversation, since, replies, taken, refused, retryAfterMs } = reading;
  return {
    type: 'replies_read',
    call_id: callId,
    ...start,
    ...answeredOf(end),
    outcome,
    conversation,
    since,
    replies,
    taken,
    refused,
    ...(retryAfterMs === null ? {} : { retry_after_ms: retryAfterMs }),
    ...recorded,
  };
}
