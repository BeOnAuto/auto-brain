import type { BrainAddress, RecordedEvent } from '@beonauto/operations';
import { Data, type Effect } from 'effect';

import type { FollowedEvent } from './followed-events.ts';

export interface CallRecord {
  readonly brain: BrainAddress;
  readonly brainKey: string;
  readonly record: RecordedEvent;
}

export interface FollowedRecord extends CallRecord {
  readonly event: FollowedEvent;
}

export class DeliveryFailed extends Data.TaggedError('delivery_failed')<{ readonly detail: string }> {}

export interface Delivery {
  readonly key: string;
  readonly workflow: string;
  readonly deliver: Effect.Effect<void, DeliveryFailed>;
  readonly skipped: (detail: string) => Effect.Effect<void>;
}

interface Batch {
  readonly deliveries: readonly Delivery[];
  readonly through: string | undefined;
  readonly more: boolean;
}

export interface RecordConsumer<Followed extends CallRecord = FollowedRecord> {
  readonly name: string;
  readonly skippedAfterSweeps: number;
  readonly batchOf: (followed: Followed, after: string | undefined, most: number) => Effect.Effect<Batch>;
}

export interface Consumer extends RecordConsumer {
  readonly types: readonly string[];
}

export interface CallConsumer extends RecordConsumer<CallRecord> {
  readonly types: readonly string[];
}

export interface BoundConsumer {
  readonly name: string;
  readonly skippedAfterSweeps: number;
  readonly batchOf: (after: string | undefined, most: number) => Effect.Effect<Batch>;
}

export function boundTo<Followed extends CallRecord>(
  consumer: RecordConsumer<Followed>,
  followed: Followed,
): BoundConsumer {
  return {
    name: consumer.name,
    skippedAfterSweeps: consumer.skippedAfterSweeps,
    batchOf: (after, most) => consumer.batchOf(followed, after, most),
  };
}

export const deliveriesOfARecordInAPass = 100;

export const deliverySweeps = 20;
