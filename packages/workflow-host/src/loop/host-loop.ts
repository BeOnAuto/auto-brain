import type { WorkflowEngine } from '@beonauto/workflow-engine';
import { Effect, Fiber } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import type { DueTimer, TimerTable } from '../timers/sql-timers.ts';
import type { HostClock } from './host-clock.ts';

export interface LoopParts {
  readonly clock: HostClock;
  readonly timers: TimerTable;
  readonly engine: WorkflowEngine;
  readonly fire: (timer: DueTimer, at: number) => Effect.Effect<void, unknown>;
  readonly resume: () => Effect.Effect<number>;
  readonly trouble: Trouble;
  readonly sweepEveryMs: number;
}

export interface HostLoop {
  readonly armed: (dueAt: number) => void;
  readonly stop: () => Promise<void>;
}

const timersInOneTick = 256;

const firesAtOnce = 16;

const overdueBeforeSwept = 60_000;

function firedDue({ timers, fire, trouble, sweepEveryMs }: LoopParts, now: number): Effect.Effect<void> {
  return Effect.flatMap(timers.due(now, timersInOneTick), (due) =>
    Effect.forEach(
      due,
      (timer) =>
        fire(timer, now).pipe(
          Effect.andThen(timers.fired(timer)),
          Effect.catchCause((cause) =>
            Effect.andThen(
              timers.postponed(timer, now + sweepEveryMs),
              trouble('A timer of a run could not fire; it fires again at the next sweep', cause),
            ),
          ),
        ),
      { concurrency: firesAtOnce, discard: true },
    ),
  );
}

function sweptBy({ engine, resume, trouble }: LoopParts, now: number): Effect.Effect<void> {
  return engine.sweep(now - overdueBeforeSwept).pipe(
    Effect.andThen(resume()),
    Effect.catchCause((cause) => trouble('A sweep of the runs failed; the next sweep tries again', cause)),
  );
}

export function startLoop(parts: LoopParts): HostLoop {
  const { clock, timers, sweepEveryMs } = parts;
  const plan = {
    wakeAt: Number.NEGATIVE_INFINITY,
    armedSince: Number.POSITIVE_INFINITY,
    lastSweptAt: Number.NEGATIVE_INFINITY,
    signal: Promise.withResolvers<void>(),
  };
  const tick = Effect.suspend(() => {
    const now = clock.now();
    const sweepDue = now >= plan.lastSweptAt + sweepEveryMs;
    if (sweepDue) {
      plan.lastSweptAt = now;
    }
    return Effect.andThen(firedDue(parts, now), sweepDue ? sweptBy(parts, now) : Effect.void);
  });
  const wait = Effect.gen(function* () {
    plan.armedSince = Number.POSITIVE_INFINITY;
    const nextDue = (yield* timers.nextDueAt()) ?? Number.POSITIVE_INFINITY;
    plan.wakeAt = Math.min(nextDue, plan.lastSweptAt + sweepEveryMs, plan.armedSince);
    plan.signal = Promise.withResolvers<void>();
    const { promise } = plan.signal;
    yield* Effect.raceFirst(
      clock.sleep(Math.max(0, plan.wakeAt - clock.now())),
      Effect.promise(() => promise),
    );
  });
  const fiber = Effect.runFork(Effect.forever(Effect.andThen(Effect.uninterruptible(tick), wait)));
  return {
    armed: (dueAt) => {
      plan.armedSince = Math.min(plan.armedSince, dueAt);
      if (dueAt < plan.wakeAt) {
        plan.signal.resolve();
      }
    },
    stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
}
