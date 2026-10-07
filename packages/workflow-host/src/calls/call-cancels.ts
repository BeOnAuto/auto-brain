import type { Lineage } from '@beonauto/operations';
import {
  callKeyText,
  type CallCancelReceipt,
  type CancelCall,
  type CancelReason,
  type OutputOrigin,
  type RunContext,
} from '@beonauto/workflow-engine';
import { Data, Effect } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { addressOfRun, type RunAddress } from '../runs/run-address.ts';
import { lineageOfSettlement } from '../runs/run-lineage.ts';
import { callRowOf, cancelledRow, tombstonedRow, type CallRow } from './call-rows.ts';

export interface ChildCancel {
  readonly child: RunAddress;
  readonly reason: CancelReason;
  readonly lineage: Lineage;
}

export type CancelChild = (cancel: ChildCancel) => Effect.Effect<unknown, Readonly<{ detail: string }>>;

export class ChildNotCancelled extends Data.TaggedError('child_not_cancelled')<{ readonly detail: string }> {}

export interface CancelParts {
  readonly database: HostDatabase;
  readonly cancelChild: CancelChild;
  readonly interrupt: (key: string) => Effect.Effect<void>;
}

export interface Cancelling {
  readonly call: CancelCall;
  readonly run: RunContext;
  readonly origin: OutputOrigin;
}

function childCancelled(
  { cancelChild }: CancelParts,
  child: string | null,
  { call, run, origin }: Cancelling,
): Effect.Effect<void, ChildNotCancelled> {
  if (child === null) {
    return Effect.void;
  }
  const { org, brain } = addressOfRun(run.executionId);
  return Effect.asVoid(
    cancelChild({
      child: { org, brain, executionId: child },
      reason: call.reason ?? 'parent_ended',
      lineage: lineageOfSettlement(run, origin),
    }).pipe(Effect.mapError(({ detail }) => new ChildNotCancelled({ detail }))),
  );
}

function cancelledAs(
  parts: CancelParts,
  row: CallRow,
  cancelling: Cancelling,
): Effect.Effect<CallCancelReceipt, DatabaseFailed | ChildNotCancelled> {
  const key = callKeyText(cancelling.call.key);
  return Effect.gen(function* () {
    if (row.state === 'answered') {
      return 'already_answered';
    }
    if (row.state === 'running') {
      yield* cancelledRow(parts.database, key);
      yield* parts.interrupt(key);
    }
    yield* childCancelled(parts, row.child, cancelling);
    if (row.state === 'waiting') {
      yield* cancelledRow(parts.database, key);
    }
    return 'cancelled';
  });
}

export function cancelledCall(
  parts: CancelParts,
  cancelling: Cancelling,
): Effect.Effect<CallCancelReceipt, DatabaseFailed | ChildNotCancelled> {
  return Effect.gen(function* () {
    const key = callKeyText(cancelling.call.key);
    const row = yield* callRowOf(parts.database, key);
    if (row !== undefined) {
      return yield* cancelledAs(parts, row, cancelling);
    }
    yield* tombstonedRow(parts.database, key, cancelling.run.executionId);
    return 'tombstoned';
  });
}
