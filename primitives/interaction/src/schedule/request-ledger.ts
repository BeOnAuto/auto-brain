import type {
  Lineage,
  ProjectionReader,
  RecordedPageRequest,
  RecordedReader,
  StreamReader,
  StreamWriter,
} from '@beonauto/operations';
import {
  executionSettler,
  outboundCallRecorder,
  type OutboundCallFact,
  type RecordedOutboundCall,
  type Settlement,
} from '@beonauto/specs';
import { Effect, Schema } from 'effect';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import type { DueRequest } from './delivery-parts.ts';
import { answeredSettlement, deliveredSettlement } from './request-endings.ts';

export interface RequestLedger
  extends StreamWriter, StreamReader, RecordedReader, Pick<ProjectionReader, 'readDueRows' | 'nextDueOf'> {}

const decodeFirst = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ correlationId: Schema.String })));

const decodeLastEnded = Schema.decodeUnknownSync(
  Schema.NonEmptyArray(
    Schema.Struct({
      id: Schema.String,
      data: Schema.Struct({
        type: Schema.Literal('delivery_ended'),
        answer: Schema.optionalKey(Schema.Json),
        at: Schema.String,
      }),
    }),
  ),
);

export function correlationOf(ledger: RecordedReader, address: RequestAddress): Effect.Effect<string> {
  return ledger
    .readRecorded(address, { kind: 'run', execution: address.id }, { order: 'asc', limit: 1, dataOf: [] })
    .pipe(
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
  return executionSettler(ledger)(address, settlement, lineage).pipe(
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

const lastEnded: RecordedPageRequest = {
  order: 'desc',
  limit: 1,
  types: ['delivery_ended'],
  dataOf: ['delivery_ended'],
};

export function settledFromChannel(ledger: RequestLedger, { address, row, lineage }: DueRequest): Effect.Effect<void> {
  return ledger.readRecorded(address, { kind: 'run', execution: address.id }, lastEnded).pipe(
    Effect.orDie,
    Effect.flatMap(({ records }) => {
      const [{ id, data }] = decodeLastEnded(records);
      const settlement =
        data.answer === undefined
          ? deliveredSettlement(data.at)
          : answeredSettlement(row.channel, data.answer, data.at);
      return settled(ledger, address, settlement, { ...lineage, causationId: id });
    }),
  );
}
