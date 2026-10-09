import type { StartedFields } from '@beonauto/mcp';
import type { DeliveryEndedFact, DeliveryStartedFact } from '@beonauto/specs';

import { attemptInFlightMs } from '../requests/open-requests.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import { attemptSchedule } from '../schedule/attempt-schedule.ts';
import type { AttemptEnd } from './attempt-end.ts';

export interface Attempting {
  readonly number: number;
  readonly target: string;
  readonly server: string;
  readonly tool: string;
}

export function startedFact(attempting: Attempting, call?: StartedFields): DeliveryStartedFact {
  const { number, target, server, tool } = attempting;
  return { type: 'delivery_started', number, target, ...(call ?? { server, tool }) };
}

export function endedFact(number: number, end: AttemptEnd, durationMs: number): DeliveryEndedFact {
  return { type: 'delivery_ended', number, ...end, duration_ms: durationMs };
}

export function lostFact(row: OpenRequestRow): DeliveryEndedFact {
  return endedFact(row.attempts, { outcome: 'failed', because: 'lost' }, attemptInFlightMs);
}

export function isLastAttempt({ outcome }: Pick<AttemptEnd, 'outcome'>, number: number): boolean {
  return outcome === 'refused' || (outcome === 'failed' && number >= attemptSchedule.attempts);
}
