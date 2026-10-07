import type { DeliveryEndedFact } from '@beonauto/specs';
import type { Schema } from 'effect';

export type AttemptFields = Omit<DeliveryEndedFact, 'type' | 'number' | 'duration_ms'>;

export interface AttemptEnd {
  readonly ended: AttemptFields;
  readonly answer?: Schema.Json;
}

export interface RequestAddress {
  readonly org: string;
  readonly brain: string;
  readonly id: string;
}

export const mostDetailBytes = 1024;

export function endedAs(ended: AttemptFields): AttemptEnd {
  return { ended };
}
