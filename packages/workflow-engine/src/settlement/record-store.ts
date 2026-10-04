import type { Effect } from 'effect';

import type { DispatchFailed, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { Settle } from '../dispatch/run-output.ts';

export type SettleReceipt = 'recorded' | 'already_recorded' | 'settled_otherwise' | 'unknown_execution';

export interface RecordStore {
  readonly settle: (settle: Settle, run: RunContext) => Effect.Effect<SettleReceipt, DispatchFailed>;
}
