import { Cause, Effect, Fiber, Schema, Semaphore } from 'effect';

import { rowsOf, type HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { playbooksWithViews } from '../views/view-statements.ts';
import { playbookKeyOfDefinitions } from './brain-definitions.ts';
import { playbookPass, type PassParts } from './brain-pass.ts';
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

const PlaybookRow = Schema.Struct({ playbook: Schema.String });

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
      const playbook = playbookKeyOfDefinitions(stream, settings.definitionType);
      if (schedule.definitions.get(playbook)?.version !== version) {
        schedule.want(playbook);
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
      const playbooks = yield* Effect.orDie(rowsOf(PlaybookRow, parts.database.read(playbooksWithViews)));
      for (const { playbook } of playbooks) {
        schedule.want(playbook);
      }
    }
  });
}

function round(parts: ProjectorParts, schedule: Schedule, passParts: PassParts): Effect.Effect<void> {
  return Effect.forEach(
    schedule.wanted(),
    (playbook) =>
      playbookPass(passParts, playbook).pipe(
        Effect.tap((more) =>
          Effect.sync(() => {
            if (more) {
              schedule.want(playbook);
            }
          }),
        ),
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          parts.reports.trouble('A pass of the views of a playbook failed; the next sweep tries again', cause),
        ),
      ),
    { concurrency: parts.settings.playbooksAtOnce, discard: true },
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
    resting: schedule.resting,
    firstSeen: firstSeenOf(mostRemembered),
    trouble: (what) => reports.trouble(what, Cause.fail(what)),
  };
}

export function startProjector(parts: ProjectorParts): Projector {
  const schedule = scheduleOf(parts.sweepEveryMs);
  const passParts = passPartsOf(parts, schedule);
  const stopListening = parts.settings.appends?.listen((playbook) => {
    if (schedule.definitions.has(playbook)) {
      schedule.want(playbook);
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
