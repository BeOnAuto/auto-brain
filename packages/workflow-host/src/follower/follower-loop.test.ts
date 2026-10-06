import { appendSignalOf } from '@beonauto/ledger';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { until } from '../reaction-testing/until.ts';
import { startFollower } from './follower-loop.ts';
import type { PassEnd } from './record-steps.ts';

const anHour = 3_600_000;

interface Watched {
  readonly raise: (stream: string) => void;
  readonly log: () => readonly string[];
}

function followerWith(passEnds: readonly (PassEnd | 'fails')[]): Watched {
  const log: string[] = [];
  const logged = (line: string) =>
    Effect.sync(() => {
      log.push(line);
    });
  const appended = appendSignalOf();
  const ends = { next: 0 };
  const follower = startFollower({
    pass: (brainKey, mode) =>
      Effect.suspend(() => {
        const end = passEnds[ends.next] ?? 'caught_up';
        ends.next += 1;
        return end === 'fails'
          ? Effect.die(new Error('The pass broke'))
          : Effect.as(logged(`pass ${brainKey} ${mode}`), end);
      }),
    discovery: {
      atStart: () => logged('start'),
      orgsChanged: () => logged('orgs'),
      brainSeen: () => Effect.void,
    },
    brains: {
      follow: () => Effect.void,
      load: () => Effect.die(new Error('The loop loads no brain')),
      save: () => Effect.void,
      dueForASweep: () => Effect.succeed([]),
    },
    upkeep: {
      sweep: () => logged('sweep'),
      fireSchedules: () => Effect.void,
      nextScheduleAt: () => Effect.succeed(null),
    },
    appended,
    clock: { now: Date.now, sleep: (milliseconds) => Effect.sleep(milliseconds) },
    sweepEveryMs: anHour,
    trouble: (what) => logged(what),
  });
  onTestFinished(() => follower.stop());
  return { raise: appended.raise, log: () => log };
}

function logReaching(watched: Watched, length: number) {
  return until(
    () => Promise.resolve<readonly string[]>([...watched.log()]),
    (log) => log.length >= length,
  );
}

describe('the follower of the brains', () => {
  it('finds the brains at its start, then sweeps, and asks again when an org registry is appended to', async () => {
    const watched = followerWith([]);
    await logReaching(watched, 3);

    watched.raise('org/acme/brains');
    const log = await logReaching(watched, 4);

    expect(log).toEqual(['start', 'orgs', 'sweep', 'orgs']);
  });

  it('passes a brain it was signalled for, and again without a signal while the pass says there is more', async () => {
    const watched = followerWith(['more', 'more', 'caught_up']);
    await logReaching(watched, 3);

    watched.raise('brain/acme/alpha/events/e1');
    watched.raise('workflow/elsewhere');
    const log = await logReaching(watched, 6);

    expect(log.slice(3)).toEqual([
      'pass brain/acme/alpha/ signal',
      'pass brain/acme/alpha/ signal',
      'pass brain/acme/alpha/ signal',
    ]);
  });

  it('says a pass that fails is trouble, and passes again at the next signal', async () => {
    const watched = followerWith(['fails']);
    await logReaching(watched, 3);

    watched.raise('brain/acme/alpha/events/e1');
    await logReaching(watched, 4);
    watched.raise('brain/acme/alpha/events/e2');
    const log = await logReaching(watched, 5);

    expect(log.slice(3)).toEqual([
      'The follower of the brains failed; it tries again',
      'pass brain/acme/alpha/ signal',
    ]);
  });
});
