import {
  runSettler,
  outboundCallRecorder,
  type OutboundCallFact,
  type RecordedOutboundCall,
  type Settlement,
} from '@beonauto/definitions';
import type {
  Lineage,
  ProjectionReader,
  RecordedPageRequest,
  RecordedReader,
  StreamReader,
  StreamWriter,
} from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import type { DueRequest } from './delivery-parts.ts';
import { answeredSettlement, deliveredSettlement } from './request-endings.ts';

export interface RequestLedger
  extends StreamWriter, StreamReader, RecordedReader, Pick<ProjectionReader, 'readDueRows' | 'nextDueOf'> {}

const decodeFirst = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ correlationId: Schema.String })));

const decodeLastBrought = Schema.decodeUnknownSync(
  Schema.NonEmptyArray(
    Schema.Struct({
      id: Schema.String,
      data: Schema.Union([
        Schema.Struct({ type: Schema.Literal('delivery_ended'), at: Schema.String }),
        Schema.Struct({
          type: Schema.Literal('reply_taken'),
          answer: Schema.Json,
          reply: Schema.Struct({ id: Schema.String, sender: Schema.String }),
          at: Schema.String,
        }),
      ]),
    }),
  ),
);

export function correlationOf(ledger: RecordedReader, address: RequestAddress): Effect.Effect<string> {
  return ledger.readRecorded(address, { kind: 'run', run: address.id }, { order: 'asc', limit: 1, dataOf: [] }).pipe(
    Effect.map(({ records }) => decodeFirst(records)[0].correlationId),
    Effect.orDie,
  );
}

export function settled(
  ledger: StreamWriter,
  address: RequestAddress,
  settlement: Settlement,
  lineage: Lineage,
): Effect.Effect<void> {
  return runSettler(ledger)(address, settlement, lineage).pipe(
    Effect.asVoid,
    Effect.catchTags({ conflict: () => Effect.void, not_found: Effect.die }),
  );
}

export function recordedCall(
  ledger: StreamWriter,
  address: RequestAddress,
  fact: OutboundCallFact,
  lineage: Lineage,
): Effect.Effect<RecordedOutboundCall | undefined> {
  return outboundCallRecorder(ledger)(address, fact, lineage).pipe(Effect.catchTag('conflict', () => Effect.undefined));
}

const lastBrought: RecordedPageRequest = {
  order: 'desc',
  limit: 1,
  types: ['delivery_ended', 'reply_taken'],
  dataOf: ['delivery_ended', 'reply_taken'],
};

export function settledFromBroughtAnswer(ledger: RequestLedger, { address, lineage }: DueRequest): Effect.Effect<void> {
  return ledger.readRecorded(address, { kind: 'run', run: address.id }, lastBrought).pipe(
    Effect.orDie,
    Effect.flatMap(({ records }) => {
      const [{ id, data }] = decodeLastBrought(records);
      const settlement = data.type === 'reply_taken' ? answeredSettlement(address, data) : deliveredSettlement(data.at);
      return settled(ledger, address, settlement, { ...lineage, causationId: id });
    }),
  );
}
