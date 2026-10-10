import { replyRecorder, type ReplyFact, type ReplyRefusal, type ReplyTaken } from '@beonauto/definitions';
import type { Issue } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ConversationParts, ConversationPlace, ReadingRoute } from '../conversations/conversation-parts.ts';
import { answeredSettlement } from '../schedule/request-endings.ts';
import { correlationOf, settled } from '../schedule/request-ledger.ts';
import { mayTell, replyBoundsOfAReading, tellingInput, type ReadingState } from './reply-recording.ts';
import { decisionOf, type KeptRequest, type Reply } from './reply-taking.ts';
import { tellingWords } from './telling-words.ts';
import { told } from './tellings.ts';

export interface Reading {
  readonly parts: ConversationParts;
  readonly place: ConversationPlace;
  readonly route: ReadingRoute;
  readonly kept: readonly KeptRequest[];
}

function recorded({ parts, place }: Reading, request: KeptRequest, fact: ReplyFact) {
  const address = { ...place.brain, id: request.runId };
  return Effect.flatMap(correlationOf(parts.ledger, address), (correlationId) =>
    replyRecorder(parts.ledger)(address, fact, { causationId: place.row.last_fact, correlationId }).pipe(
      Effect.map((made) => ({ ...made, address, correlationId })),
      Effect.catchTag('conflict', () => Effect.undefined),
    ),
  );
}

function identityOf({ id, sender }: Reply) {
  return { id, sender };
}

function readThrough({ route }: Reading) {
  return { server: route.server, tool: route.replies.tool };
}

function taken(reading: Reading, state: ReadingState, request: KeptRequest, fact: ReplyTaken) {
  return Effect.gen(function* () {
    const made = yield* recorded(reading, request, fact);
    if (made === undefined) {
      return state;
    }
    const brought = { answer: fact.data.answer, at: made.at, reply: fact.data.reply };
    yield* settled(reading.parts.ledger, made.address, answeredSettlement(reading.place.brain, brought), {
      causationId: made.id,
      correlationId: made.correlationId,
    });
    return {
      ...state,
      taken: state.taken + 1,
      foundAnswerer: true,
      answered: new Set([...state.answered, request.runId]),
    };
  });
}

interface Refusal {
  readonly request: KeptRequest;
  readonly reply: Reply;
  readonly because: ReplyRefusal;
  readonly issues: readonly Issue[];
}

function refusedReply(reading: Reading, state: ReadingState, { request, reply, because, issues }: Refusal) {
  return Effect.gen(function* () {
    const input = mayTell(state, request)
      ? tellingInput(reading.route, request, tellingWords(request.rule, because, issues))
      : undefined;
    const kept = issues.slice(0, replyBoundsOfAReading.issues);
    const fact: ReplyFact = {
      type: 'reply_refused',
      data: {
        ...readThrough(reading),
        reply: identityOf(reply),
        because,
        ...(kept.length === 0 ? {} : { issues: kept }),
        told: input !== undefined,
      },
    };
    const made = yield* recorded(reading, request, fact);
    if (made === undefined) {
      return state;
    }
    if (input !== undefined) {
      yield* told(reading.parts, {
        brain: reading.place.brain,
        server: reading.route.server,
        tool: reading.route.replies.tell?.tool ?? reading.route.delivering,
        runId: request.runId,
        input,
        lineage: { causationId: made.id, correlationId: made.correlationId },
      });
    }
    const toldNow = (state.told.get(request.runId) ?? 0) + (input === undefined ? 0 : 1);
    return {
      ...state,
      refused: state.refused + 1,
      foundAnswerer: true,
      told: new Map([...state.told, [request.runId, toldNow]]),
    };
  });
}

export function handledReply(reading: Reading, state: ReadingState, reply: Reply): Effect.Effect<ReadingState> {
  const decision = decisionOf(reply, reading.kept, state.answered);
  if (decision.kind === 'nothing') {
    return Effect.succeed(state);
  }
  if (decision.kind === 'take') {
    const fact: ReplyTaken = {
      type: 'reply_taken',
      data: { ...readThrough(reading), reply: identityOf(reply), answer: decision.answer },
    };
    return taken(reading, state, decision.request, fact);
  }
  return refusedReply(reading, state, { ...decision, reply });
}
