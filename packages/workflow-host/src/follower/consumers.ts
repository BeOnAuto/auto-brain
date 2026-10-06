import type { BrainAddress, RecordedEvent } from '@beonauto/operations';
import { Data, type Effect } from 'effect';

import type { FollowedEvent } from './followed-events.ts';

export interface FollowedRecord {
  readonly brain: BrainAddress;
  readonly brainKey: string;
  readonly record: RecordedEvent;
  readonly event: FollowedEvent;
}

export class DeliveryFailed extends Data.TaggedError('delivery_failed')<{ readonly detail: string }> {}

export interface Delivery {
  readonly key: string;
  readonly workflow: string;
  readonly deliver: Effect.Effect<void, DeliveryFailed>;
}

interface Batch {
  readonly deliveries: readonly Delivery[];
  readonly through: string | undefined;
  readonly more: boolean;
}

export interface RecordConsumer {
  readonly name: string;
  readonly skippedAfterSweeps: number;
  readonly batchOf: (followed: FollowedRecord, after: string | undefined, most: number) => Effect.Effect<Batch>;
  readonly skipped: (followed: FollowedRecord, delivery: Delivery, detail: string) => Effect.Effect<void>;
}

export interface Consumer extends RecordConsumer {
  readonly types: readonly string[];
}

export const deliveriesOfARecordInAPass = 100;

export const deliverySweeps = 20;
