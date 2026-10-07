import { recordedRunIn, type Settlement } from '@beonauto/specs';
import { Clock, Effect } from 'effect';

import { channelFor } from '../channels/channel-settings.ts';
import { attemptOf } from '../delivery/attempt-delivery.ts';
import type { AttemptEnd } from '../delivery/attempt-end.ts';
import { endedFact, isLastAttempt, lostFact, startedFact } from '../delivery/attempt-facts.ts';
import { requestRecordOf } from '../run/request-record.ts';
import type { DeliveryParts, DueRequest } from './delivery-parts.ts';
import { answeredSettlement, deliveredSettlement, undeliveredSettlement } from './request-endings.ts';
import { recordedCall, settled } from './request-ledger.ts';

function settlementAfter(request: DueRequest, number: number, end: AttemptEnd, at: string): Settlement | undefined {
  const { row } = request;
  if (end.answer !== undefined) {
    return answeredSettlement(row.channel, end.answer, at);
  }
  if (row.answers) {
    return undefined;
  }
  if (end.ended.outcome === 'delivered') {
    return deliveredSettlement(at);
  }
  return isLastAttempt(end.ended, number) ? undeliveredSettlement(row) : undefined;
}

function settledAfter(parts: DeliveryParts, request: DueRequest, number: number, end: AttemptEnd) {
  return Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const settlement = settlementAfter(request, number, end, new Date(now).toISOString());
    return settlement === undefined ? Effect.void : settled(parts.ledger, request.address, settlement, request.lineage);
  });
}

export function lostAttempt(parts: DeliveryParts, { address, row, lineage }: DueRequest): Effect.Effect<void> {
  return Effect.asVoid(recordedCall(parts.ledger, address, lostFact(row), lineage));
}

export function nextAttempt(parts: DeliveryParts, request: DueRequest): Effect.Effect<void> {
  const { address, row, lineage } = request;
  return Effect.gen(function* () {
    const recorded = yield* recordedRunIn(parts.ledger, address);
    const start = startedFact(row);
    const startedId =
      recorded?.awaitsSettlement === true ? yield* recordedCall(parts.ledger, address, start, lineage) : undefined;
    if (recorded === undefined || startedId === undefined) {
      return;
    }
    const began = yield* Clock.currentTimeMillis;
    const answerSchema = requestRecordOf(recorded.run.record)?.answer_schema;
    const end = yield* attemptOf(parts, channelFor(parts.channels, row.channel, address), request, answerSchema);
    const ended = endedFact(start.number, end, (yield* Clock.currentTimeMillis) - began);
    const endedId = yield* recordedCall(parts.ledger, address, ended, { ...lineage, causationId: startedId });
    const settling = { ...request, lineage: { ...lineage, causationId: endedId ?? startedId } };
    yield* settledAfter(parts, settling, start.number, end);
  });
}
