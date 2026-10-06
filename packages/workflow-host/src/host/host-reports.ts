import type { TroublingReceipt } from '@beonauto/workflow-engine';
import type { Effect } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import type { RunAddress } from '../runs/run-address.ts';

export type HostNote =
  | { readonly kind: 'standing_by'; readonly holder: string; readonly until: number }
  | { readonly kind: 'took_over'; readonly holder: string }
  | {
      readonly kind: 'settle_backing_off';
      readonly run: RunAddress;
      readonly attempts: number;
      readonly detail: string;
    }
  | { readonly kind: 'settled_after_back_off'; readonly run: RunAddress; readonly attempts: number }
  | {
      readonly kind: 'record_passed_over';
      readonly brain: string;
      readonly record: string;
      readonly reason: 'unreadable';
    }
  | { readonly kind: 'view_stalled'; readonly brain: string; readonly name: string; readonly version: number };

export interface UnsettledRun extends RunAddress {
  readonly receipt: TroublingReceipt;
}

export interface HostReports {
  readonly unsettled: (run: UnsettledRun) => Effect.Effect<void>;
  readonly trouble: Trouble;
  readonly lostConnection: (error: Readonly<Error>) => void;
  readonly note: (note: HostNote) => Effect.Effect<void>;
}
