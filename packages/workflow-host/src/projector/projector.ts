import { Cause, Effect, Fiber, Schema, Semaphore } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { brainsWithViews } from '../views/view-statements.ts';
import { brainKeyOfDefinitions } from './brain-definitions.ts';
import { brainPass, type PassParts } from './brain-pass.ts';
import { scheduleOf, type Schedule } from './projector-schedule.ts';
import { shareOfThePool, type ProjectorSettings } from './projector-settings.ts';

export interface Projector {
  readonly stop: () => Promise<void>;
}

export interface ProjectorParts {
  readonly database: HostDatabase;
  readonly settings: ProjectorSettings;
  readonly reports: HostReports;
  readonly clock: HostClock;
  readonly sweepEveryMs: number;
}

const BrainRow = Schema.Struct({ brain: Schema.String });

const mostRemembered = 1024;

export function firstSeenOf(most: number): (record: string) => boolean {
  const seen = new Set<string>();
  return (record) => {
    if (seen.has(record)) {
      return false;
    }
    seen.add(record);
    for (const oldest of seen.values().take(Math.max(0, seen.size - most))) {
      seen.delete(oldest);
    }
    return true;
  };
}

function discovered({ database, settings }: ProjectorParts, schedule: Schedule): Effect.Effect<void> {
  return Effect.gen(function* () {
    const streams = yield* Effect.promise(() => database.store.definitionStreams(settings.definitionType));
    for (const { stream, version } of streams) {
      const brain = brainKeyOfDefinitions(stream, settings.definitionType);
      if (schedule.definitions.get(brain)?.version !== version) {
        schedule.want(brain);
      }
    }
  });
}

function swept(parts: ProjectorParts, schedule: Schedule): Effect.Effect<void> {
  return Effect.gen(function* () {
    const now = parts.clock.now();
    const sweepDue = schedule.sweepDue(now);
    const discoveryDue = schedule.discoveryDue();
    if (!sweepDue && !discoveryDue) {
      return;
    }
    yield* discovered(parts, schedule);
    if (sweepDue) {
      schedule.swept(now);
      const brains = yield* Effect.orDie(rowsOf(BrainRow, parts.database.read(brainsWithViews)));
      for (const { brain } of brains) {
        schedule.want(brain);
      }
    }
  });
}

function round(parts: ProjectorParts, schedule: Schedule, passParts: PassParts): Effect.Effect<void> {
  return Effect.forEach(
    schedule.wanted(),
    (brain) =>
      brainPass(passParts, brain).pipe(
        Effect.tap((more) =>
          Effect.sync(() => {
            if (more) {
              schedule.want(brain);
            }
          }),
        ),
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          parts.reports.trouble('A pass of the views of a brain failed; the next sweep tries again', cause),
        ),
      ),
    { concurrency: parts.settings.brainsAtOnce, discard: true },
  );
}

function waited({ clock }: ProjectorParts, schedule: Schedule): Effect.Effect<void> {
  if (!schedule.idle()) {
    return Effect.void;
  }
  const woken = schedule.woken();
  return Effect.raceFirst(
    clock.sleep(schedule.untilSweep(clock.now())),
    Effect.promise(() => woken),
  );
}

function passPartsOf({ database, settings, reports }: ProjectorParts, schedule: Schedule): PassParts {
  return {
    database,
    settings,
    share: Semaphore.makeUnsafe(shareOfThePool(settings.pool)),
    reconciling: {
      database,
      definitionType: settings.definitionType,
      rebuildsAtOnce: settings.rebuildsAtOnce,
      definitions: schedule.definitions,
    },
    note: reports.note,
    firstSeen: firstSeenOf(mostRemembered),
    trouble: (what) => reports.trouble(what, Cause.fail(what)),
  };
}

export function startProjector(parts: ProjectorParts): Projector {
  const schedule = scheduleOf(parts.sweepEveryMs);
  const passParts = passPartsOf(parts, schedule);
  const stopListening = parts.settings.appends?.listen((brain) => {
    if (schedule.definitions.has(brain)) {
      schedule.want(brain);
    } else {
      schedule.discover();
    }
    schedule.wake();
  });
  const cycle = Effect.andThen(
    swept(parts, schedule),
    Effect.suspend(() => round(parts, schedule, passParts)),
  ).pipe(
    Effect.catchCause((cause) =>
      parts.reports.trouble('A sweep of the views failed; the next sweep tries again', cause),
    ),
  );
  const fiber = Effect.runFork(
    Effect.forever(
      Effect.andThen(
        cycle,
        Effect.suspend(() => waited(parts, schedule)),
      ),
    ),
  );
  return {
    stop: async () => {
      stopListening?.();
      await Effect.runPromise(Fiber.interrupt(fiber));
    },
  };
}
