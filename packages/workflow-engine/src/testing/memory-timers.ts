import { Effect } from 'effect';

import { DispatchFailed } from '../dispatch/dispatch-watermark.ts';
import type { ArmTimer, RunOutput } from '../dispatch/run-output.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { ArmReceipt, TimerCancelReceipt, Timers } from '../timers/timers.ts';
import type { VirtualClock } from './virtual-clock.ts';

export type Submit = (input: RunInput) => void;

export interface Dispatched {
  readonly at: number;
  readonly output: RunOutput;
}

export interface Faults {
  readonly failNext: (kind: RunOutput['kind']) => void;
  readonly attempt: <A>(output: RunOutput, work: () => A) => Effect.Effect<A, DispatchFailed>;
  readonly dispatched: () => readonly Dispatched[];
}

export interface MemoryTimers extends Timers {
  readonly forget: () => void;
}

export function faultsOf(clock: VirtualClock): Faults {
  const failing = new Set<RunOutput['kind']>();
  const dispatched: Dispatched[] = [];
  return {
    failNext: (kind) => {
      failing.add(kind);
    },
    attempt: (output, work) =>
      Effect.suspend(() => {
        if (failing.delete(output.kind)) {
          return Effect.fail(new DispatchFailed({ output: output.kind, detail: 'The port was told to fail once' }));
        }
        dispatched.push({ at: clock.now(), output });
        return Effect.succeed(work());
      }),
    dispatched: () => dispatched,
  };
}

interface Firing {
  readonly fire: (timer: ArmTimer) => void;
  readonly hasFired: (timerId: string) => boolean;
  readonly disarm: (timerId: string) => boolean;
  readonly forget: () => void;
}

function firingOf(clock: VirtualClock, submit: Submit): Firing {
  const fired = new Set<string>();
  const armed = new Set<string>();
  return {
    fire: ({ executionId, timerId, dueAt }) => {
      armed.add(timerId);
      clock.schedule(dueAt, timerId, () => {
        armed.delete(timerId);
        fired.add(timerId);
        submit({ kind: 'timer_fired', executionId, at: clock.now(), timerId });
      });
    },
    hasFired: (timerId) => fired.has(timerId),
    disarm: (timerId) => armed.delete(timerId) && clock.unschedule(timerId),
    forget: () => {
      for (const timerId of armed) {
        clock.unschedule(timerId);
      }
      armed.clear();
    },
  };
}

export function memoryTimers(clock: VirtualClock, submit: Submit, faults: Faults): MemoryTimers {
  const firing = firingOf(clock, submit);
  const tombstones = new Set<string>();
  const arm = (timer: ArmTimer): ArmReceipt => {
    if (tombstones.has(timer.timerId)) {
      return 'refused_after_cancel';
    }
    if (clock.has(timer.timerId) || firing.hasFired(timer.timerId)) {
      return 'already_armed';
    }
    firing.fire(timer);
    return 'armed';
  };
  const cancel = (timerId: string): TimerCancelReceipt => {
    if (firing.disarm(timerId)) {
      return 'cancelled';
    }
    if (firing.hasFired(timerId)) {
      return 'already_fired';
    }
    tombstones.add(timerId);
    return 'tombstoned';
  };
  return {
    arm: (timer) => faults.attempt(timer, () => arm(timer)),
    cancel: (timer) => faults.attempt(timer, () => cancel(timer.timerId)),
    sweep: (_run, timers) =>
      Effect.sync(() => {
        const lost = timers.filter(({ timerId }) => !clock.has(timerId) && !firing.hasFired(timerId));
        for (const timer of lost) {
          firing.fire(timer);
        }
        return lost.length;
      }),
    forget: firing.forget,
  };
}
