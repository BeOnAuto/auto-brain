import type { Effect } from 'effect';

import type { DispatchFailed, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { ArmTimer, CancelTimer } from '../dispatch/run-output.ts';

export interface Timers {
  readonly arm: (timer: ArmTimer, run: RunContext) => Effect.Effect<void, DispatchFailed>;
  readonly cancel: (timer: CancelTimer, run: RunContext) => Effect.Effect<void, DispatchFailed>;
}
