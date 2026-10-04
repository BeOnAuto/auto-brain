import type { Settlement } from '@beonauto/operations';
import type { Effect } from 'effect';

import type { DispatchFailed, RunContext } from '../dispatch/dispatch-watermark.ts';

export type SettleReceipt = 'recorded' | 'already_recorded' | 'settled_otherwise' | 'unknown_execution';

export interface SettleRequest {
  readonly executionId: string;
  readonly settlement: Settlement;
}

export interface RecordStore {
  readonly settle: (request: SettleRequest, run: RunContext) => Effect.Effect<SettleReceipt, DispatchFailed>;
  readonly liveRuns: () => Effect.Effect<readonly string[]>;
}
