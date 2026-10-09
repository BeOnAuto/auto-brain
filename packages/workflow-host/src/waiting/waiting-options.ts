import type { CancelRun, RunEnding, SettleCancelled } from '@beonauto/definitions';
import type { CallResult } from '@beonauto/operations';

export interface WaitingOptions {
  readonly resultOf: (ending: RunEnding) => CallResult;
  readonly cancel: CancelRun;
  readonly cancelDeferred: SettleCancelled;
}

export const mostOpenCallsOfATree = 1000;
