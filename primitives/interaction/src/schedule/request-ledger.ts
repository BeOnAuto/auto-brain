import type { Lineage, ProjectionReader, RecordedReader, StreamReader, StreamWriter } from '@beonauto/operations';
import { executionSettler, outboundCallRecorder, type OutboundCallFact, type Settlement } from '@beonauto/specs';
import { Effect, Schema } from 'effect';

import type { RequestAddress } from '../delivery/attempt-end.ts';

export interface RequestLedger extends StreamWriter, StreamReader, RecordedReader, ProjectionReader {}

const decodeFirst = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ correlationId: Schema.String })));

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
): Effect.Effect<string | undefined> {
  return outboundCallRecorder(ledger)(address, fact, lineage).pipe(Effect.catchTag('conflict', () => Effect.undefined));
}
