import { setTimeout } from 'node:timers/promises';

import { streamSignalOf, type AppendedStreams } from '@beonauto/ledger';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { FollowedBrains } from '../follower/followed-brains.ts';
import { startFollower } from '../follower/follower-loop.ts';
import type { PassEnd } from '../follower/record-steps.ts';
import { systemClock } from '../loop/host-clock.ts';
import { until } from '../reaction-testing/until.ts';
import { brainSweepsOn } from './brain-sweeps.ts';

const alpha = 'brain/acme/alpha/';

const beta = 'brain/acme/beta/';

const noBrains: FollowedBrains = {
  follow: () => Effect.void,
  load: () => Effect.die(new Error('The sweeps hand every brain known')),
  save: () => Effect.void,
  waitingForASweep: () => Effect.succeed([]),
  following: () => Effect.succeed([]),
};

interface Following {
  readonly streams: readonly string[];
  readonly sweepEveryMs: number;
  readonly pass: (brainKey: string) => Effect.Effect<PassEnd>;
  readonly upkeepFailing?: (sweep: number) => boolean;
  readonly registries?: (registries: readonly string[]) => Effect.Effect<void>;
  readonly brainSeen?: (brainKey: string) => Effect.Effect<void>;
}

interface Followed {
  readonly sweeps: () => number;
  readonly upkeeps: () => number;
  readonly troubles: () => readonly string[];
  readonly stop: () => Promise<void>;
}

function followed(following: Following): Followed {
  const {
    streams,
    sweepEveryMs,
    pass,
    upkeepFailing = () => false,
    registries = () => Effect.void,
    brainSeen = () => Effect.void,
  } = following;
  const counts = { reads: 0, upkeeps: 0 };
  const troubles: string[] = [];
  const store = {
    readAppended: (): Promise<AppendedStreams> => {
      counts.reads += 1;
      const appended = counts.reads === 2 ? streams : [];
      return Promise.resolve({ streams: appended, through: [String(counts.reads)], more: false });
    },
  };
  const upkeep = () =>
    Effect.suspend(() => {
      counts.upkeeps += 1;
      return upkeepFailing(counts.upkeeps) ? Effect.die(new Error('The backlog could not be read')) : Effect.void;
    });
  const follower = startFollower({
    pass,
    discovery: { atStart: () => Effect.void, registriesAppended: registries, brainSeen },
    sweeps: brainSweepsOn(store, noBrains),
    upkeep: { sweep: upkeep, fireSchedules: () => Effect.void, nextScheduleAt: () => Effect.succeed(null) },
    appended: streamSignalOf(),
    clock: systemClock,
    pace: systemClock,
    sweepEveryMs,
    trouble: (what) =>
      Effect.sync(() => {
        troubles.push(what);
      }),
  });
  onTestFinished(() => follower.stop());
  return {
    sweeps: () => counts.reads - 1,
    upkeeps: () => counts.upkeeps,
    troubles: () => troubles,
    stop: follower.stop,
  };
}

function failingOnceFor<A>(failing: string, otherwise: (brainKey: string) => Effect.Effect<A>) {
  const failures = { left: 1 };
  return (brainKey: string) =>
    Effect.suspend(() => {
      if (brainKey === failing && failures.left > 0) {
        failures.left -= 1;
        return Effect.die(new Error('The ledger could not be read'));
      }
      return otherwise(brainKey);
    });
}

function passesRecorded(passed: (brainKey: string) => void) {
  return (brainKey: string) =>
    Effect.sync((): PassEnd => {
      passed(brainKey);
      return 'caught_up';
    });
}

function passesFailingFirstFor(failing: string, passed: (brainKey: string) => void) {
  return failingOnceFor(failing, passesRecorded(passed));
}

function passedReaching(passes: readonly string[], count: number) {
  return until(
    () => Promise.resolve<readonly string[]>([...passes]),
    (brains) => brains.length >= count,
  );
}

describe('a sweep in which the pass over a brain fails', () => {
  it(
    'passes the brains after it in the same sweep, and the brain again at the next sweep',
    { timeout: 30_000 },
    async () => {
      const passes: string[] = [];
      const watched = followed({
        streams: [`${alpha}events/`, `${beta}events/`],
        sweepEveryMs: 20,
        pass: passesFailingFirstFor(alpha, (brainKey) => {
          passes.push(brainKey);
        }),
      });

      const passed = await passedReaching(passes, 2);

      expect(passed).toEqual([beta, alpha]);
      expect(watched.troubles()).toEqual(['A pass over a brain failed; the next sweep passes the brain again']);
    },
  );

  it('passes the brain again when the next sweep fails before its passes', { timeout: 30_000 }, async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: [`${alpha}events/`],
      sweepEveryMs: 20,
      pass: passesFailingFirstFor(alpha, (brainKey) => {
        passes.push(brainKey);
      }),
      upkeepFailing: (sweep) => sweep === 2,
    });

    const passed = await passedReaching(passes, 1);

    expect(passed).toEqual([alpha]);
    expect(watched.troubles()).toEqual([
      'A pass over a brain failed; the next sweep passes the brain again',
      'The follower of the brains failed; it tries again',
    ]);
  });
});

describe('a sweep in which following a brain it finds fails', () => {
  it(
    'passes the brains after it in the same sweep, and the brain again at the next sweep',
    { timeout: 30_000 },
    async () => {
      const passes: string[] = [];
      const watched = followed({
        streams: [`${alpha}events/`, `${beta}events/`],
        sweepEveryMs: 20,
        pass: passesRecorded((brainKey) => {
          passes.push(brainKey);
        }),
        brainSeen: failingOnceFor(alpha, () => Effect.void),
      });

      const passed = await passedReaching(passes, 2);

      expect(passed).toEqual([beta, alpha]);
      expect(watched.troubles()).toEqual(['A pass over a brain failed; the next sweep passes the brain again']);
    },
  );
});

describe('a sweep in which more brains fail than it has room for', () => {
  it('waits for the next interval rather than sweeping again at once', { timeout: 30_000 }, async () => {
    const streams = Array.from({ length: 130 }, (_, index) => `brain/acme/b${index}/events/`);
    const watched = followed({
      streams,
      sweepEveryMs: 1000,
      pass: () => Effect.die(new Error('The ledger could not be read')),
    });

    await setTimeout(500);

    expect(watched.sweeps()).toBeLessThanOrEqual(2);
  });
});

function registryReadFailingOnce(read: (registries: readonly string[]) => void) {
  const failures = { left: 1 };
  return (registries: readonly string[]) =>
    Effect.suspend(() => {
      failures.left -= 1;
      if (failures.left >= 0) {
        return Effect.die(new Error('The registry could not be read'));
      }
      read(registries);
      return Effect.void;
    });
}

describe('a sweep whose read of a registry of brains fails', () => {
  it('reads the registry again at the next sweep after its read failed', { timeout: 30_000 }, async () => {
    const followedFrom: string[] = [];
    const watched = followed({
      streams: ['org/acme/brains'],
      sweepEveryMs: 20,
      pass: () => Effect.succeed<PassEnd>('caught_up'),
      registries: registryReadFailingOnce((registries) => {
        followedFrom.push(...registries);
      }),
    });

    const read = await until(
      () => Promise.resolve<readonly string[]>([...followedFrom]),
      (registries) => registries.length > 0,
    );

    expect(read).toEqual(['org/acme/brains']);
    expect(watched.troubles()).toEqual(['A registry of brains could not be read; the next sweep reads it again']);
  });
});

describe('a sweep whose read of a registry of brains keeps failing', () => {
  it('still passes the brains appended to, and still runs its upkeep', { timeout: 30_000 }, async () => {
    const passes: string[] = [];
    const watched = followed({
      streams: ['org/acme/brains', 'brain/acme/alpha/events/'],
      sweepEveryMs: 50,
      pass: (brainKey) =>
        Effect.sync(() => {
          passes.push(brainKey);
          return 'caught_up' satisfies PassEnd;
        }),
      registries: () => Effect.die(new Error('The registry could not be read')),
    });

    const passed = await passedReaching(passes, 1);
    await until(
      () => Promise.resolve(watched.upkeeps()),
      (upkeeps) => upkeeps >= 3,
    );
    await watched.stop();

    expect(passed).toEqual(['brain/acme/alpha/']);
    expect(watched.upkeeps()).toBe(watched.sweeps());
    expect(watched.troubles()).toEqual(
      Array.from(
        { length: watched.sweeps() },
        () => 'A registry of brains could not be read; the next sweep reads it again',
      ),
    );
  });
});
