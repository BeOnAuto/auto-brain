import type { DeliveryEndedFact } from '@beonauto/specs';

export type AttemptEnd = Omit<DeliveryEndedFact, 'type' | 'number' | 'duration_ms'>;

export interface RequestAddress {
  readonly org: string;
  readonly brain: string;
  readonly id: string;
}
