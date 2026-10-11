import {
  runEventOf,
  runSettler,
  workRecorder,
  type RecordedWorkAt,
  type Settlement,
  type Work,
  type WorkRule,
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
import { interactionRunFacts } from '../facts/declared-facts.ts';
import type { DeliveryEvent } from '../facts/run-facts.ts';
import { deliveryRule } from '../facts/work-rules.ts';
import type { DueRequest } from './delivery-parts.ts';
import { answeredSettlement, deliveredSettlement } from './request-endings.ts';

export interface RequestLedger
  extends
    StreamWriter,
    StreamReader,
    Pick<RecordedReader, 'readRecorded'>,
    Pick<ProjectionReader, 'readDueRows' | 'nextDueOf'> {}

const decodeFirst = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ correlationId: Schema.String })));

export function correlationOf(
  ledger: Pick<RecordedReader, 'readRecorded'>,
  address: RequestAddress,
): Effect.Effect<string> {
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

export interface RuledWork {
  readonly work: Work;
  readonly rule: WorkRule;
}

export function recordedWork(
  ledger: StreamReader & StreamWriter,
  address: RequestAddress,
  { work, rule }: RuledWork,
  lineage: Lineage,
): Effect.Effect<RecordedWorkAt | undefined> {
  return workRecorder(ledger, interactionRunFacts)(address, work, lineage, rule).pipe(
    Effect.catchTag('conflict', () => Effect.undefined),
  );
}

export function recordedCall(
  ledger: StreamReader & StreamWriter,
  address: RequestAddress,
  fact: DeliveryEvent,
  lineage: Lineage,
): Effect.Effect<RecordedWorkAt | undefined> {
  return recordedWork(ledger, address, { work: { type: 'work', fact }, rule: deliveryRule(fact) }, lineage);
}

const lastDelivered: RecordedPageRequest = { order: 'desc', limit: 1, types: ['delivery_succeeded'], dataOf: [] };

const lastAnswered: RecordedPageRequest = {
  order: 'desc',
  limit: 1,
  types: ['request_answered'],
  dataOf: ['request_answered'],
};

const decodeLast = Schema.decodeUnknownSync(
  Schema.NonEmptyArray(Schema.Struct({ id: Schema.String, context: Schema.Struct({ at: Schema.String }) })),
);

function settlementOf(recorded: unknown, at: string): Settlement {
  const fact = runEventOf(recorded);
  return fact?.type === 'request_answered'
    ? answeredSettlement({ answer: fact.data.answer, by: fact.context.by })
    : deliveredSettlement(at);
}

export function settledFromAnswer(ledger: RequestLedger, { address, row, lineage }: DueRequest): Effect.Effect<void> {
  return ledger
    .readRecorded(address, { kind: 'run', run: address.id }, row.answers ? lastAnswered : lastDelivered)
    .pipe(
      Effect.orDie,
      Effect.flatMap(({ records }) => {
        const [last] = decodeLast(records);
        const settlement = settlementOf(records[0], last.context.at);
        return settled(ledger, address, settlement, { ...lineage, causationId: last.id });
      }),
    );
}
