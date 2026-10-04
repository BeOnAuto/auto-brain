import { Schema, type Effect } from 'effect';

import type { DispatchFailed, RunContext } from '../dispatch/dispatch-watermark.ts';

export const SettlementSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json }),
  Schema.Struct({
    status: Schema.Literal('rejected'),
    reason: Schema.Literals(['invalid_input', 'unavailable']),
    detail: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literal('failed') }),
]);

export type Settlement = typeof SettlementSchema.Type;

export type SettleReceipt = 'recorded' | 'already_recorded' | 'settled_otherwise' | 'unknown_execution';

export interface SettleRequest {
  readonly executionId: string;
  readonly settlement: Settlement;
}

export interface RecordStore {
  readonly settle: (request: SettleRequest, run: RunContext) => Effect.Effect<SettleReceipt, DispatchFailed>;
  readonly liveRuns: () => Effect.Effect<readonly string[]>;
}
