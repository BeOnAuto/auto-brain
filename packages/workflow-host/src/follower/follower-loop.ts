import type { StreamSignal } from '@beonauto/ledger';
import { Effect, Fiber } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import type { HostClock } from '../loop/host-clock.ts';
import type { BrainSweeps } from '../sweeps/brain-sweeps.ts';
import { wakesOf, type Wakes } from '../sweeps/wakes.ts';
import type { Discovery } from './brain-discovery.ts';
import type { Mode } from './delivery-loop.ts';
import type { FollowedBrain } from './followed-brains.ts';
import type { PassEnd } from './record-steps.ts';

export interface Upkeep {
  readonly sweep: () => Effect.Effect<void>;
  readonly fireSchedules: () => Effect.Effect<void>;
  readonly nextScheduleAt: () => Effect.Effect<number | null>;
}

export interface FollowerParts {
  readonly pass: (brainKey: string, mode: Mode, known?: FollowedBrain) => Effect.Effect<PassEnd>;
  readonly discovery: Discovery;
  readonly sweeps: BrainSweeps;
  readonly upkeep: Upkeep;
  readonly appended: StreamSignal;
  readonly clock: HostClock;
  readonly pace: HostClock;
  readonly sweepEveryMs: number;
  readonly trouble: Trouble;
}

export interface Follower {
  readonly stop: () => Promise<void>;
}

interface Passing {
  readonly brainKey: string;
  readonly mode: Mode;
  readonly known: FollowedBrain | undefined;
}

function passedOnce(parts: FollowerParts, wakes: Wakes, { brainKey, mode, known }: Passing) {
  return parts.pass(brainKey, mode, known).pipe(
    Effect.tap((end) =>
      Effect.sync(() => {
        if (end === 'more') {
          wakes.brainAgain(brainKey);
        }
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.andThen(
        parts.trouble('A pass over a brain failed; the next sweep passes the brain again', cause),
        Effect.sync(() => {
          parts.sweeps.passAgain(brainKey);
        }),
      ),
    ),
  );
}

function registriesRead(parts: FollowerParts, registries: readonly string[]): Effect.Effect<void> {
  return registries.length === 0 ? Effect.void : parts.discovery.registriesAppended(registries);
}

function registryRead(parts: FollowerParts, registry: string): Effect.Effect<void> {
  return parts.discovery.registriesAppended([registry]).pipe(
    Effect.andThen(
      Effect.sync(() => {
        parts.sweeps.registriesRead([registry]);
      }),
    ),
    Effect.catchCause((cause) =>
      parts.trouble('A registry of brains could not be read; the next sweep reads it again', cause),
    ),
  );
}

function signalled(parts: FollowerParts, wakes: Wakes) {
  return Effect.gen(function* () {
    yield* registriesRead(parts, wakes.registriesWoken());
    yield* Effect.forEach(
      wakes.brainsWoken(),
      (brainKey) =>
        Effect.andThen(
          parts.discovery.brainSeen(brainKey),
          passedOnce(parts, wakes, { brainKey, mode: 'signal', known: undefined }),
        ),
      { discard: true },
    );
  });
}

function swept(parts: FollowerParts, wakes: Wakes) {
  return Effect.gen(function* () {
    const sweep = yield* parts.sweeps.next();
    const handedBack = Effect.sync(() => {
      for (const { brainKey } of sweep.brains) {
        parts.sweeps.passAgain(brainKey);
      }
    });
    yield* Effect.forEach(sweep.registries, (registry) => registryRead(parts, registry), { discard: true });
    yield* parts.upkeep.sweep().pipe(Effect.catchCause((cause) => Effect.andThen(handedBack, Effect.failCause(cause))));
    yield* Effect.forEach(
      sweep.brains,
      ({ brainKey, known }) =>
        Effect.andThen(
          known === undefined ? parts.discovery.brainSeen(brainKey) : Effect.void,
          passedOnce(parts, wakes, { brainKey, mode: 'sweep', known }),
        ),
      { discard: true },
    );
    if (sweep.again) {
      wakes.sweepSoon();
    }
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

function startedOf({ sweeps, discovery, trouble, pace, sweepEveryMs }: FollowerParts): Effect.Effect<void> {
  const started: Effect.Effect<void> = Effect.andThen(sweeps.started(), discovery.atStart()).pipe(
    Effect.catchCause((cause) =>
      trouble(
        'The follower of the brains could not find the brains at its start; it tries again at the next sweep',
        cause,
      ).pipe(Effect.andThen(pace.sleep(sweepEveryMs)), Effect.andThen(Effect.suspend(() => started))),
    ),
  );
  return started;
}

function nextScheduleOf({ upkeep, trouble }: FollowerParts): Effect.Effect<number | null> {
  return upkeep
    .nextScheduleAt()
    .pipe(
      Effect.catchCause((cause) =>
        Effect.as(
          trouble('The next due time of the schedules could not be read; the follower waits for the next sweep', cause),
          null,
        ),
      ),
    );
}

function waitOf(parts: FollowerParts, wakes: Wakes) {
  const { clock, pace } = parts;
  return Effect.gen(function* () {
    const signal = wakes.nextSignal();
    if (wakes.anyWoken()) {
      return;
    }
    const schedule = (yield* nextScheduleOf(parts)) ?? Number.POSITIVE_INFINITY;
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
    Effect.andThen(startedOf(parts), Effect.forever(Effect.andThen(Effect.uninterruptible(tick), wait))),
  );
  return {
    stop: async () => {
      stopListening();
      await Effect.runPromise(Fiber.interrupt(fiber));
    },
  };
}
