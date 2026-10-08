import {
  conversationCallDecider,
  conversationCallStreamOf,
  repliesReadOf,
  type StartedFields,
  type CalledOnce,
} from '@beonauto/mcp';
import { brainCallerOf, streamPrefixOfBrain, type StreamWriter } from '@beonauto/operations';
import { DateTime, Effect } from 'effect';

import type { ReadingState } from '../replies/reply-recording.ts';
import type { ConversationPlace } from './conversation-parts.ts';
import type { ReadAnswer } from './read-answers.ts';

export interface ReadRecord {
  readonly start: StartedFields;
  readonly called: CalledOnce;
  readonly answer: ReadAnswer;
  readonly state: ReadingState;
  readonly callId: string;
  readonly since: string | null;
}

export function recordedRead(
  ledger: StreamWriter,
  { brain, row }: ConversationPlace,
  { start, called, answer, state, callId, since }: ReadRecord,
): Effect.Effect<void> {
  const stream = `${streamPrefixOfBrain(brain)}${conversationCallStreamOf(callId)}`;
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const fact = repliesReadOf(
      {
        callId,
        start,
        end: called,
        outcome: answer.outcome,
        conversation: row.conversation,
        since,
        replies: answer.considered,
        taken: state.taken,
        refused: state.refused,
        retryAfterMs: answer.retryAfterMs,
      },
      { by: brainCallerOf(brain).id, at },
    );
    yield* ledger
      .execute(stream, conversationCallDecider, fact, { causationId: row.last_fact, correlationId: null })
      .pipe(Effect.orDie);
  });
}
