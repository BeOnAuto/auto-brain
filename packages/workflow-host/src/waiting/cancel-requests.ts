import type { BrainAddress, Conflict, Lineage, RecordedEvent } from '@beonauto/operations';
import { cancelRequestOf, type CancelRequested } from '@beonauto/specs';
import type { RunInput, Submission } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { DeliveryFailed, type CallConsumer, type CallRecord, type Delivery } from '../follower/consumers.ts';
import { runIdOf } from '../runs/run-address.ts';
import { passedOverRow } from './pending-cancel-rows.ts';
import type { WaitingOptions } from './waiting-options.ts';

export interface CancelParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly cancelDeferred: WaitingOptions['cancelDeferred'];
  readonly workflows: string;
  readonly now: () => number;
}

interface Asked {
  readonly brain: BrainAddress;
  readonly record: RecordedEvent;
  readonly request: CancelRequested;
  readonly primitive: string;
  readonly executionId: string;
}

function failedWith({ detail }: Readonly<{ detail: string }>): DeliveryFailed {
  return new DeliveryFailed({ detail });
}

function lineageOf({ id, correlationId }: RecordedEvent): Lineage {
  return { causationId: id, correlationId };
}

function cancelledWorkflow(parts: CancelParts, { brain, record, request, executionId }: Asked) {
  const { kind, reason, by } = request;
  const runId = runIdOf({ ...brain, executionId });
  const pending = { runId, cause: record.id, cancel: { by, kind, reason } };
  return parts.submitted({ kind: 'cancel_requested', executionId: runId, at: parts.now(), ...pending }).pipe(
    Effect.flatMap(({ outcome }) => (outcome === 'not_started' ? passedOverRow(parts.database, pending) : Effect.void)),
    Effect.mapError(failedWith),
  );
}

function cancelled(parts: CancelParts, asked: Asked): Effect.Effect<void, DeliveryFailed> {
  const { brain, record, request, primitive, executionId } = asked;
  if (primitive === parts.workflows) {
    return cancelledWorkflow(parts, asked);
  }
  const { kind, reason, by } = request;
  return parts
    .cancelDeferred({ ...brain, id: executionId }, { kind, reason, by }, lineageOf(record))
    .pipe(Effect.mapError(failedWith));
}

function deliveriesOf(parts: CancelParts, { brain, record }: CallRecord): readonly Delivery[] {
  const request = cancelRequestOf(record.data);
  const primitive = request?.primitive;
  if (request === undefined || primitive === undefined) {
    return [];
  }
  const executionId = record.stream.slice(record.stream.lastIndexOf('/') + 1);
  const delivery: Delivery = {
    key: 'cancel',
    workflow: executionId,
    deliver: cancelled(parts, { brain, record, request, primitive, executionId }),
  };
  return [delivery];
}

export function cancelRequests(parts: CancelParts): CallConsumer {
  return {
    name: 'cancel_requests',
    types: ['execution_cancel_requested'],
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    batchOf: (followed, after) =>
      Effect.sync(() => ({
        deliveries: after === undefined ? deliveriesOf(parts, followed) : [],
        through: undefined,
        more: false,
      })),
    skipped: () => Effect.void,
  };
}
