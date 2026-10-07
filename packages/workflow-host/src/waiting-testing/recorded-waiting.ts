import type { CallResult, Lineage } from '@beonauto/operations';
import type { CancelReceipt, CancelRequest, ExecutionAddress, RunEnding } from '@beonauto/specs';
import { Effect } from 'effect';

import type { WaitingOptions } from '../waiting/waiting-options.ts';

interface RecordedCancel {
  readonly execution: ExecutionAddress;
  readonly request: CancelRequest;
  readonly lineage: Lineage;
}

export interface RecordedWaiting {
  readonly options: WaitingOptions;
  readonly cancels: () => readonly RecordedCancel[];
  readonly deferredCancels: () => readonly RecordedCancel[];
}

export function resultOfEnding(ending: RunEnding): CallResult {
  if (ending.type === 'execution_succeeded') {
    return { status: 'succeeded', output: ending.output };
  }
  return ending.type === 'execution_rejected'
    ? { status: 'rejected', reason: ending.rejection.reason, detail: ending.rejection.detail }
    : { status: 'failed', detail: 'The run broke down' };
}

export function recordedWaiting(receipt: CancelReceipt = 'requested'): RecordedWaiting {
  const cancels: RecordedCancel[] = [];
  const deferredCancels: RecordedCancel[] = [];
  return {
    options: {
      resultOf: resultOfEnding,
      cancel: (execution, request, lineage) =>
        Effect.sync(() => {
          cancels.push({ execution, request, lineage });
          return receipt;
        }),
      cancelDeferred: (execution, request, lineage) =>
        Effect.sync(() => {
          deferredCancels.push({ execution, request, lineage });
        }),
    },
    cancels: () => cancels,
    deferredCancels: () => deferredCancels,
  };
}
