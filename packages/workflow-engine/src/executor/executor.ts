import type { Effect } from 'effect';

import type { DispatchFailed, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { CancelCall, StartCall } from '../dispatch/run-output.ts';

export interface Executor {
  readonly start: (call: StartCall, run: RunContext) => Effect.Effect<void, DispatchFailed>;
  readonly cancel: (call: CancelCall, run: RunContext) => Effect.Effect<void, DispatchFailed>;
}
