import { appendSignalOf, type AppendedStreams } from '@beonauto/ledger';
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

function appendedOnce(streams: readonly string[]) {
  const reads = { count: 0 };
  return {
    readAppended: (): Promise<AppendedStreams> => {
      reads.count += 1;
      return Promise.resolve({
        streams: reads.count === 2 ? streams : [],
        through: [String(reads.count)],
        more: false,
      });
    },
  };
}

function passesFailingFirstFor(failing: string, passed: (line: string) => void) {
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

describe('a sweep in which the pass over a brain fails', () => {
  it(
    'passes the brains after it in the same sweep, and the brain again at the next sweep',
    { timeout: 30_000 },
    async () => {
      const passes: string[] = [];
      const troubles: string[] = [];
      const follower = startFollower({
        pass: passesFailingFirstFor(alpha, (brainKey) => {
          passes.push(brainKey);
        }),
        discovery: { atStart: () => Effect.void, registriesAppended: () => Effect.void, brainSeen: () => Effect.void },
        sweeps: brainSweepsOn(appendedOnce([`${alpha}events/`, `${beta}events/`]), noBrains),
        upkeep: {
          sweep: () => Effect.void,
          fireSchedules: () => Effect.void,
          nextScheduleAt: () => Effect.succeed(null),
        },
        appended: appendSignalOf(),
        clock: systemClock,
        pace: systemClock,
        sweepEveryMs: 20,
        trouble: (what) =>
          Effect.sync(() => {
            troubles.push(what);
          }),
      });
      onTestFinished(() => follower.stop());

      const passed = await until(
        () => Promise.resolve<readonly string[]>([...passes]),
        (brains) => brains.length >= 2,
      );

      expect(passed).toEqual([beta, alpha]);
      expect(troubles).toEqual(['A pass over a brain failed; the next sweep passes the brain again']);
    },
  );
});
