import type { Settlement } from '@beonauto/operations';
import type { Effect } from 'effect';

import type { DispatchFailed, RunContext } from '../dispatch/dispatch-watermark.ts';

export type SettleReceipt = 'recorded' | 'already_recorded' | 'settled_otherwise' | 'unknown_execution';

export type TroublingReceipt = Extract<SettleReceipt, 'settled_otherwise' | 'unknown_execution'>;

export interface SettleRequest {
  readonly executionId: string;
  readonly settlement: Settlement;
}

export interface RunDue {
  readonly executionId: string;
  readonly version: number;
  readonly nextDueAt: number | null;
  readonly behind: boolean;
}

export interface RecordStore {
  readonly settle: (request: SettleRequest, run: RunContext) => Effect.Effect<SettleReceipt, DispatchFailed>;
  readonly noteDue: (due: RunDue, run: RunContext) => Effect.Effect<void, DispatchFailed>;
  readonly dueRuns: (before: number) => Effect.Effect<readonly string[]>;
}

export interface UnsettledReport {
  readonly run: RunContext;
  readonly receipt: TroublingReceipt;
}

export interface RunReporter {
  readonly unsettled: (report: UnsettledReport) => Effect.Effect<void>;
}

export function isTroubling(receipt: SettleReceipt): receipt is TroublingReceipt {
  return receipt === 'settled_otherwise' || receipt === 'unknown_execution';
}
