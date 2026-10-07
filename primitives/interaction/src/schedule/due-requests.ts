import type { ProjectedRunRow } from '@beonauto/operations';
import { Effect } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom, settlesFromDelivery, type OpenRequestRow } from '../requests/request-rows.ts';
import type { DeliveryParts, DueRequest } from './delivery-parts.ts';
import { lostAttempt, nextAttempt } from './request-attempts.ts';
import { expiredSettlement, undeliveredSettlement } from './request-endings.ts';
import { correlationOf, settled, settledFromDelivery } from './request-ledger.ts';

export interface DueRequestItem {
  readonly key: string;
  readonly perform: (now: number) => Effect.Effect<void>;
}

export interface RequestsDue {
  readonly name: string;
  readonly due: (now: number, most: number) => Effect.Effect<readonly DueRequestItem[]>;
  readonly nextDueAt: (after: number) => Effect.Effect<number | null>;
}

function performedNow(parts: DeliveryParts, request: DueRequest, now: number): Effect.Effect<void> {
  const { row, address, lineage } = request;
  if (settlesFromDelivery(row)) {
    return settledFromDelivery(parts.ledger, request);
  }
  if (now >= row.expires_at) {
    return settled(parts.ledger, address, expiredSettlement(row), lineage);
  }
  if (!row.answers && row.standing === 'undelivered') {
    return settled(parts.ledger, address, undeliveredSettlement(row), lineage);
  }
  if (row.next_attempt_at === null || now < row.next_attempt_at) {
    return Effect.void;
  }
  return row.standing === 'delivering' ? lostAttempt(parts, request) : nextAttempt(parts, request);
}

function performedRow(parts: DeliveryParts, kept: ProjectedRunRow, row: OpenRequestRow, now: number) {
  const address = { org: kept.org, brain: kept.brain, id: kept.runId };
  return Effect.flatMap(correlationOf(parts.ledger, address), (correlationId) =>
    performedNow(parts, { address, row, lineage: { causationId: row.request_id, correlationId } }, now),
  );
}

function itemOf(parts: DeliveryParts, kept: ProjectedRunRow): DueRequestItem {
  return {
    key: `${kept.org}/${kept.brain}/${kept.runId}`,
    perform: (now) => Effect.suspend(() => performedRow(parts, kept, requestRowFrom(kept.row), now)),
  };
}

export function requestsDue(parts: DeliveryParts): RequestsDue {
  return {
    name: 'the open requests of interaction functions',
    due: (now, most) =>
      Effect.map(parts.ledger.readDueRows(openRequestsName, { column: 'due_at', through: now, limit: most }), (rows) =>
        rows.map((kept) => itemOf(parts, kept)),
      ),
    nextDueAt: (after) => parts.ledger.nextDueOf(openRequestsName, 'due_at', after),
  };
}
