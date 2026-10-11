import { conversationCallIdKey } from '@beonauto/mcp/policy';
import { randomUUIDv7 } from '@beonauto/operations';
import { Effect, Result } from 'effect';

import { handledReply, type Reading } from '../replies/reply-handling.ts';
import { nothingRead, readArguments, type ReadingState } from '../replies/reply-recording.ts';
import type { KeptRequest } from '../replies/reply-taking.ts';
import { argumentsFailureWords } from '../tool-blocks/rendered-arguments.ts';
import { failedRead, readAnswerOf, type ReadAnswer } from './read-answers.ts';
import { cursorOf } from './read-cadence.ts';
import { recordedRead } from './read-records.ts';

export interface ReadDone {
  readonly answer: ReadAnswer;
  readonly state: ReadingState;
}

export function readReplies(reading: Reading, oldest: KeptRequest): Effect.Effect<ReadDone> {
  const { parts, place, route } = reading;
  const input = readArguments(route, place.row, oldest);
  const callId = randomUUIDv7();
  const reference = { server: route.server, tool: route.replies.tool };
  if (Result.isFailure(input)) {
    const unsent = { answer: failedRead('not_sent'), state: nothingRead };
    const detail = argumentsFailureWords(input.failure, 'the read');
    const record = { start: reference, detail, ...unsent, callId, since: place.row.since };
    return Effect.as(recordedRead(parts.ledger, place, record), unsent);
  }
  const call = {
    ...place.brain,
    reference,
    input: input.success.input,
    meta: { [conversationCallIdKey]: callId },
  };
  return Effect.gen(function* () {
    const start = yield* parts.tools.startOf(call);
    const called = yield* parts.tools.callOnce(call);
    const answer = readAnswerOf(route.replies, called);
    const state = yield* Effect.reduce(
      answer.replies,
      () => nothingRead,
      (kept, reply) => handledReply(reading, kept, reply),
    );
    if (answer.outcome !== 'result' || answer.considered > 0) {
      const since = cursorOf(route.replies.read.order, answer.ids, place.row.since);
      yield* recordedRead(parts.ledger, place, { start, called, answer, state, callId, since });
    }
    return { answer, state };
  });
}
