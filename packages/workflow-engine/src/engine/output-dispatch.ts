import { Effect, Result } from 'effect';

import { dispatchedThrough, type DispatchFailed, type RunContext } from '../dispatch/dispatch-watermark.ts';
import { changesTimers, runDueOf } from '../dispatch/run-due.ts';
import type { RunOutput } from '../dispatch/run-output.ts';
import type { RunState } from '../machine/run-state.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
import { isTroubling } from '../settlement/record-store.ts';
import type { EnginePorts, Wake } from './workflow-engine.ts';

function performed(ports: EnginePorts, run: RunContext, output: RunOutput): Effect.Effect<unknown, DispatchFailed> {
  if (output.kind === 'arm_timer') {
    return ports.timers.arm(output, run);
  }
  if (output.kind === 'cancel_timer') {
    return ports.timers.cancel(output, run);
  }
  if (output.kind === 'start_call') {
    return ports.executor.start(output, run);
  }
  if (output.kind === 'cancel_call') {
    return ports.executor.cancel(output, run);
  }
  return ports.recordStore
    .settle({ executionId: output.executionId, settlement: output.settlement }, run)
    .pipe(Effect.tap((receipt) => (isTroubling(receipt) ? ports.reporter.unsettled({ run, receipt }) : Effect.void)));
}

function firstFailureIn(
  ports: EnginePorts,
  run: RunContext,
  events: readonly PositionedEvent[],
): Effect.Effect<number | null> {
  return Effect.gen(function* () {
    for (const { version, event } of events) {
      for (const output of event.outputs) {
        const done = yield* Effect.result(performed(ports, run, output));
        if (Result.isFailure(done)) {
          return version;
        }
      }
    }
    return null;
  });
}

export function dispatchRun(ports: EnginePorts, state: RunState, version: number): Effect.Effect<Wake> {
  const run: RunContext = { executionId: state.executionId, attributes: state.attributes };
  return Effect.gen(function* () {
    const watermark = yield* ports.watermark.read(run.executionId);
    const events = yield* ports.runStore.eventsAfter(run.executionId, watermark);
    const failed = yield* firstFailureIn(ports, run, events);
    const through = dispatchedThrough(watermark, events, failed ?? undefined);
    if (failed !== null || events.some((event) => changesTimers(event))) {
      yield* Effect.ignore(ports.recordStore.noteDue(runDueOf(state, version, failed !== null), run));
    }
    yield* ports.watermark.advance(run.executionId, through);
    return { version, dispatchedThrough: through };
  });
}
