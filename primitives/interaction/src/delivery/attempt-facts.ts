import { Buffer } from 'node:buffer';

import { outboundBounds } from '@beonauto/outbound';
import type { DeliveryEndedFact, DeliveryStartedFact } from '@beonauto/specs';

import { attemptInFlightMs } from '../requests/open-requests.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import { mostDetailBytes, type AttemptFields } from './attempt-end.ts';

function cutDetail(detail: string): string {
  const bytes = Buffer.from(detail, 'utf8');
  return bytes.length <= mostDetailBytes ? detail : new TextDecoder().decode(bytes.subarray(0, mostDetailBytes));
}

export function startedFact(row: OpenRequestRow): DeliveryStartedFact {
  return { type: 'delivery_started', number: row.attempts + 1, channel: row.channel, target: row.party };
}

export function endedFact(number: number, { detail, ...ended }: AttemptFields, durationMs: number): DeliveryEndedFact {
  return {
    type: 'delivery_ended',
    number,
    ...ended,
    ...(detail === undefined ? {} : { detail: cutDetail(detail) }),
    duration_ms: durationMs,
  };
}

export function lostFact(row: OpenRequestRow): DeliveryEndedFact {
  return endedFact(row.attempts, { outcome: 'failed', because: 'lost' }, attemptInFlightMs);
}

export function isLastAttempt({ outcome }: AttemptFields, number: number): boolean {
  return outcome === 'refused' || (outcome === 'failed' && number >= outboundBounds.attempts);
}
