import type { AppendSignal } from '@beonauto/ledger';
import { Effect, Fiber } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import type { HostClock } from '../loop/host-clock.ts';
import type { Discovery } from './brain-discovery.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedBrain, FollowedBrains } from './followed-brains.ts';
import type { PassEnd } from './record-steps.ts';
import { wakesOf, type Wakes } from './wakes.ts';

export interface Upkeep {
  readonly sweep: () => Effect.Effect<void>;
  readonly fireSchedules: () => Effect.Effect<void>;
  readonly nextScheduleAt: () => Effect.Effect<number | null>;
}

export interface FollowerParts {
  readonly pass: (brainKey: string, mode: Mode, known?: FollowedBrain) => Effect.Effect<PassEnd>;
  readonly discovery: Discovery;
  readonly brains: FollowedBrains;
  readonly upkeep: Upkeep;
  readonly appended: AppendSignal;
  readonly clock: HostClock;
  readonly pace: HostClock;
  readonly sweepEveryMs: number;
  readonly trouble: Trouble;
}

export interface Follower {
  readonly stop: () => Promise<void>;
}

const brainsInASweep = 128;

interface Passing {
  readonly brainKey: string;
  readonly mode: Mode;
  readonly known?: FollowedBrain;
}

function passedOnce(parts: FollowerParts, wakes: Wakes, { brainKey, mode, known }: Passing) {
  return Effect.tap(parts.pass(brainKey, mode, known), (end) =>
    Effect.sync(() => {
      if (end === 'more') {
        wakes.brainAgain(brainKey);
      }
    }),
  );
}

function signalled(parts: FollowerParts, wakes: Wakes) {
  return Effect.gen(function* () {
    if (wakes.orgsWoken()) {
      yield* parts.discovery.orgsChanged();
    }
    yield* Effect.forEach(
      wakes.brainsWoken(),
      (brainKey) =>
        Effect.andThen(parts.discovery.brainSeen(brainKey), passedOnce(parts, wakes, { brainKey, mode: 'signal' })),
      { discard: true },
    );
  });
}

function swept(parts: FollowerParts, wakes: Wakes) {
  return Effect.gen(function* () {
    yield* parts.discovery.orgsChanged();
    yield* parts.upkeep.sweep();
    const due = yield* parts.brains.dueForASweep(brainsInASweep);
    yield* Effect.forEach(
      due,
      (brain) => passedOnce(parts, wakes, { brainKey: brain.brainKey, mode: 'sweep', known: brain }),
      { discard: true },
    );
  });
}

function tickOf(parts: FollowerParts, wakes: Wakes) {
  return Effect.gen(function* () {
    const now = parts.pace.now();
    yield* parts.upkeep.fireSchedules();
    yield* signalled(parts, wakes);
    if (wakes.sweepDue(now)) {
      yield* swept(parts, wakes);
    }
  }).pipe(Effect.catchCause((cause) => parts.trouble('The follower of the brains failed; it tries again', cause)));
}

function waitOf({ clock, pace, upkeep }: FollowerParts, wakes: Wakes) {
  return Effect.gen(function* () {
    const signal = wakes.nextSignal();
    if (wakes.anyWoken()) {
      return;
    }
    const schedule = (yield* upkeep.nextScheduleAt()) ?? Number.POSITIVE_INFINITY;
    const delay = Math.min(wakes.nextSweepAt() - pace.now(), schedule - clock.now());
    yield* Effect.raceFirst(
      pace.sleep(Math.max(0, delay)),
      Effect.promise(() => signal),
    );
  });
}

export function startFollower(parts: FollowerParts): Follower {
  const wakes = wakesOf(parts.sweepEveryMs);
  const stopListening = parts.appended.listen(wakes.woken);
  const tick = tickOf(parts, wakes);
  const wait = waitOf(parts, wakes);
  const fiber = Effect.runFork(
    Effect.andThen(parts.discovery.atStart(), Effect.forever(Effect.andThen(Effect.uninterruptible(tick), wait))),
  );
  return {
    stop: async () => {
      stopListening();
      await Effect.runPromise(Fiber.interrupt(fiber));
    },
  };
}
