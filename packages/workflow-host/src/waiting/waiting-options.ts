import type { CallResult } from '@beonauto/operations';
import type { CancelExecution, RunEnding, SettleCancelled } from '@beonauto/specs';

export interface WaitingOptions {
  readonly resultOf: (ending: RunEnding) => CallResult;
  readonly cancel: CancelExecution;
  readonly cancelDeferred: SettleCancelled;
}

export const mostOpenCallsOfATree = 1000;
