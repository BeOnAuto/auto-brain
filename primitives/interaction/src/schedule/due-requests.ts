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
  readonly callsOut: boolean;
  readonly perform: (now: number) => Effect.Effect<void>;
}

type DueAction = 'settle_from_delivery' | 'expire' | 'end_undelivered' | 'wait' | 'end_lost' | 'attempt';

function dueActionOf(row: OpenRequestRow, now: number): DueAction {
  if (settlesFromDelivery(row)) {
    return 'settle_from_delivery';
  }
  if (now >= row.expires_at) {
    return 'expire';
  }
  if (!row.answers && row.standing === 'undelivered') {
    return 'end_undelivered';
  }
  if (row.next_attempt_at === null || now < row.next_attempt_at) {
    return 'wait';
  }
  return row.standing === 'delivering' ? 'end_lost' : 'attempt';
}

export interface RequestsDue {
  readonly name: string;
  readonly due: (now: number, most: number, callsOut: boolean) => Effect.Effect<readonly DueRequestItem[]>;
  readonly nextDueAt: (after: number) => Effect.Effect<number | null>;
}

function performedNow(parts: DeliveryParts, request: DueRequest, now: number): Effect.Effect<void> {
  const { row, address, lineage } = request;
  const performed: Readonly<Record<DueAction, () => Effect.Effect<void>>> = {
    settle_from_delivery: () => settledFromDelivery(parts.ledger, request),
    expire: () => settled(parts.ledger, address, expiredSettlement(row), lineage),
    end_undelivered: () => settled(parts.ledger, address, undeliveredSettlement(row), lineage),
    wait: () => Effect.void,
    end_lost: () => lostAttempt(parts, request),
    attempt: () => nextAttempt(parts, request),
  };
  return performed[dueActionOf(row, now)]();
}

function performedRow(parts: DeliveryParts, kept: ProjectedRunRow, row: OpenRequestRow, now: number) {
  const address = { org: kept.org, brain: kept.brain, id: kept.runId };
  return Effect.flatMap(correlationOf(parts.ledger, address), (correlationId) =>
    performedNow(parts, { address, row, lineage: { causationId: row.request_id, correlationId } }, now),
  );
}

function itemOf(parts: DeliveryParts, kept: ProjectedRunRow, dueAt: number): DueRequestItem {
  const row = requestRowFrom(kept.row);
  return {
    key: `${kept.org}/${kept.brain}/${kept.runId}`,
    callsOut: dueActionOf(row, dueAt) === 'attempt',
    perform: (now) => Effect.suspend(() => performedRow(parts, kept, row, now)),
  };
}

const dueColumns = ['attempt_due_at', 'ending_due_at'];

function soonestOf(times: readonly (number | null)[]): number | null {
  const set = times.filter((time) => time !== null);
  return set.length === 0 ? null : Math.min(...set);
}

export function requestsDue(parts: DeliveryParts): RequestsDue {
  return {
    name: 'the open requests of interaction functions',
    due: (now, most, callsOut) =>
      Effect.map(
        parts.ledger.readDueRows(openRequestsName, {
          column: callsOut ? 'attempt_due_at' : 'ending_due_at',
          through: now,
          limit: most,
        }),
        (rows) => rows.map((kept) => itemOf(parts, kept, now)),
      ),
    nextDueAt: (after) =>
      Effect.map(
        Effect.forEach(dueColumns, (column) => parts.ledger.nextDueOf(openRequestsName, column, after)),
        soonestOf,
      ),
  };
}
