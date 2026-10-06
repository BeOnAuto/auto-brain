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
}

interface Followed {
  readonly sweeps: () => number;
  readonly troubles: () => readonly string[];
}

function followed({ streams, sweepEveryMs, pass, upkeepFailing = () => false }: Following): Followed {
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
    discovery: { atStart: () => Effect.void, registriesAppended: () => Effect.void, brainSeen: () => Effect.void },
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
  return { sweeps: () => counts.reads - 1, troubles: () => troubles };
}

function passesFailingFirstFor(failing: string, passed: (brainKey: string) => void) {
  const failures = { left: 1 };
  return (brainKey: string) =>
    Effect.suspend(() => {
      if (brainKey === failing && failures.left > 0) {
        failures.left -= 1;
        return Effect.die(new Error('The ledger could not be read'));
      }
      passed(brainKey);
      return Effect.succeed<PassEnd>('caught_up');
    });
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
