import type { RecordedWorkAt, Work } from '@beonauto/definitions';
import { brainCallerOf } from '@beonauto/operations';
import { Effect, type Schema } from 'effect';

import type { ConversationParts, ConversationPlace } from '../conversations/conversation-parts.ts';
import type { RequestAddress } from '../delivery/attempt-end.ts';
import { replyRule } from '../facts/work-rules.ts';
import { answeredSettlement } from '../schedule/request-endings.ts';
import { correlationOf, recordedWork, settled } from '../schedule/request-ledger.ts';
import type { KeptRequest, Reply } from './reply-taking.ts';

export interface ReplyPlace {
  readonly parts: ConversationParts;
  readonly place: ConversationPlace;
}

export interface RecordedReply extends RecordedWorkAt {
  readonly address: RequestAddress;
  readonly correlationId: string;
}

export function recordedReplyWork(
  { parts, place }: ReplyPlace,
  request: KeptRequest,
  reply: Reply,
  work: Work,
): Effect.Effect<RecordedReply | undefined> {
  const address = { ...place.brain, id: request.runId };
  const rule = replyRule(reply.id, work.type === 'work');
  return Effect.flatMap(correlationOf(parts.ledger, address), (correlationId) =>
    recordedWork(parts.ledger, address, { work, rule }, { causationId: place.row.last_fact, correlationId }).pipe(
      Effect.map((made) => (made === undefined ? undefined : { id: made.id, at: made.at, address, correlationId })),
    ),
  );
}

export function settledFromTheReply(
  { parts, place }: ReplyPlace,
  made: RecordedReply,
  answer: Schema.Json,
): Effect.Effect<void> {
  const by = brainCallerOf(place.brain).id;
  return settled(parts.ledger, made.address, answeredSettlement({ answer, by }), {
    causationId: made.id,
    correlationId: made.correlationId,
  });
}
