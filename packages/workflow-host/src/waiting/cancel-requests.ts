import type { BrainAddress, Conflict, Lineage, RecordedEvent } from '@beonauto/operations';
import { cancelRequestOf, type CancelRequested, type SettleExecution } from '@beonauto/specs';
import type { RunInput, Submission } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { DeliveryFailed, type CallConsumer, type Delivery } from '../follower/consumers.ts';
import { runIdOf } from '../runs/run-address.ts';
import { settlementRecorded } from '../settlement/ledger-record-store.ts';
import type { WaitingOptions } from './waiting-options.ts';

export const startGraceMs = 60_000;

export interface CancelParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly settle: SettleExecution;
  readonly cancelDeferred: WaitingOptions['cancelDeferred'];
  readonly workflows: string;
  readonly now: () => number;
}

interface Asked {
  readonly brain: BrainAddress;
  readonly record: RecordedEvent;
  readonly request: CancelRequested;
  readonly executionId: string;
}

function failedWith({ detail }: Readonly<{ detail: string }>): DeliveryFailed {
  return new DeliveryFailed({ detail });
}

function lineageOf({ id, correlationId }: RecordedEvent): Lineage {
  return { causationId: id, correlationId };
}

function settledBeforeItStarted(parts: CancelParts, { brain, record, request, executionId }: Asked) {
  const { kind, reason, by } = request;
  const settlement = { status: 'rejected', reason: 'cancelled', kind, detail: reason, by } as const;
  if (parts.now() - Date.parse(record.recordedAt) < startGraceMs) {
    return Effect.fail(
      new DeliveryFailed({ detail: 'The workflow has not started yet, so its cancel waits until it has' }),
    );
  }
  return parts
    .settle({ ...brain, id: executionId }, settlement, lineageOf(record))
    .pipe(
      Effect.andThen(settlementRecorded(parts.database, runIdOf({ ...brain, executionId }), settlement)),
      Effect.asVoid,
      Effect.mapError(failedWith),
    );
}

function cancelledWorkflow(parts: CancelParts, asked: Asked): Effect.Effect<void, DeliveryFailed> {
  const { brain, record, request, executionId } = asked;
  const { kind, reason, by } = request;
  return parts
    .submitted({
      kind: 'cancel_requested',
      executionId: runIdOf({ ...brain, executionId }),
      at: parts.now(),
      cancel: { by, kind, reason },
      cause: record.id,
    })
    .pipe(
      Effect.mapError(failedWith),
      Effect.flatMap(({ outcome }) => (outcome === 'not_started' ? settledBeforeItStarted(parts, asked) : Effect.void)),
    );
}

function cancelled(parts: CancelParts, asked: Asked): Effect.Effect<void, DeliveryFailed> {
  const { brain, record, request, executionId } = asked;
  if (request.primitive === parts.workflows) {
    return cancelledWorkflow(parts, asked);
  }
  const { kind, reason, by } = request;
  return parts
    .cancelDeferred({ ...brain, id: executionId }, { kind, reason, by }, lineageOf(record))
    .pipe(Effect.mapError(failedWith));
}

function deliveryOf(parts: CancelParts, asked: Asked): Delivery {
  return { key: 'cancel', workflow: asked.request.name, deliver: cancelled(parts, asked) };
}

export function cancelRequests(parts: CancelParts): CallConsumer {
  return {
    name: 'cancel_requests',
    types: ['execution_cancel_requested'],
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    batchOf: ({ brain, record }, after) =>
      Effect.sync(() => {
        const request = after === undefined ? cancelRequestOf(record.data) : undefined;
        const executionId = record.stream.slice(record.stream.lastIndexOf('/') + 1);
        return {
          deliveries: request === undefined ? [] : [deliveryOf(parts, { brain, record, request, executionId })],
          through: undefined,
          more: false,
        };
      }),
    skipped: () => Effect.void,
  };
}
