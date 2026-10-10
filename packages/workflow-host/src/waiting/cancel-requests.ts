import { cancelRequestOf, type CancelRequested } from '@beonauto/definitions';
import type { BrainAddress, Conflict, Lineage, RecordedEvent } from '@beonauto/operations';
import type { RunInput, Submission } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { DeliveryFailed, type CallConsumer, type CallRecord, type Delivery } from '../follower/consumers.ts';
import { runKeyOf } from '../runs/run-address.ts';
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
  readonly type: string;
  readonly runId: string;
}

function failedWith({ detail }: Readonly<{ detail: string }>): DeliveryFailed {
  return new DeliveryFailed({ detail });
}

function lineageOf({ id, correlationId }: RecordedEvent): Lineage {
  return { causationId: id, correlationId };
}

function cancelledWorkflow(parts: CancelParts, { brain, record, request, runId }: Asked) {
  const { kind, reason } = request.data;
  const { by } = request.context;
  const runKey = runKeyOf({ ...brain, runId });
  const pending = { runKey, cause: record.id, cancel: { by, kind, reason } };
  return parts.submitted({ kind: 'cancel_requested', runId: runKey, at: parts.now(), ...pending }).pipe(
    Effect.flatMap(({ outcome }) => (outcome === 'not_started' ? passedOverRow(parts.database, pending) : Effect.void)),
    Effect.mapError(failedWith),
  );
}

function cancelled(parts: CancelParts, asked: Asked): Effect.Effect<void, DeliveryFailed> {
  const { brain, record, request, type, runId } = asked;
  if (type === parts.workflows) {
    return cancelledWorkflow(parts, asked);
  }
  const { kind, reason } = request.data;
  const { by } = request.context;
  return parts
    .cancelDeferred({ ...brain, id: runId }, { kind, reason, by }, lineageOf(record))
    .pipe(Effect.mapError(failedWith));
}

function deliveriesOf(parts: CancelParts, { brain, record }: CallRecord): readonly Delivery[] {
  const request = cancelRequestOf(record);
  const type = request?.context.definitionType;
  if (request === undefined || type === undefined) {
    return [];
  }
  const runId = record.stream.slice(record.stream.lastIndexOf('/') + 1);
  const delivery: Delivery = {
    key: 'cancel',
    workflow: runId,
    deliver: cancelled(parts, { brain, record, request, type, runId }),
  };
  return [delivery];
}

export function cancelRequests(parts: CancelParts): CallConsumer {
  return {
    name: 'cancel_requests',
    types: ['run_cancel_requested'],
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
