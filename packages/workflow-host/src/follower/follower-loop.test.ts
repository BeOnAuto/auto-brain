import { appendSignalOf } from '@beonauto/ledger';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { systemClock } from '../loop/host-clock.ts';
import { until } from '../reaction-testing/until.ts';
import { startFollower } from './follower-loop.ts';
import type { PassEnd } from './record-steps.ts';

const anHour = 3_600_000;

interface Watched {
  readonly raise: (stream: string) => void;
  readonly log: () => readonly string[];
}

interface Failing {
  readonly sweepEveryMs: number;
  readonly atStart: number;
  readonly nextScheduleAt: number;
}

const neverFailing: Failing = { sweepEveryMs: anHour, atStart: 0, nextScheduleAt: 0 };

function failingFirst<A>(times: number, read: Effect.Effect<A>): () => Effect.Effect<A> {
  const failures = { left: times };
  return () =>
    Effect.suspend(() => {
      failures.left -= 1;
      return failures.left < 0 ? read : Effect.die(new Error('The database is down'));
    });
}

function followerWith(passEnds: readonly (PassEnd | 'fails')[], failing: Failing = neverFailing): Watched {
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
      atStart: failingFirst(failing.atStart, logged('start')),
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
      nextScheduleAt: failingFirst(failing.nextScheduleAt, Effect.succeed(null)),
    },
    appended,
    clock: systemClock,
    pace: systemClock,
    sweepEveryMs: failing.sweepEveryMs,
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

  it('passes a brain an event was appended to, not one a run appended to, and again while the pass says there is more', async () => {
    const watched = followerWith(['more', 'more', 'caught_up']);
    await logReaching(watched, 3);

    watched.raise('brain/acme/beta/runs/r-1');
    watched.raise('brain/acme/alpha/events/e1');
    watched.raise('workflow/elsewhere');
    const log = await logReaching(watched, 6);

    expect(log.slice(3)).toEqual([
      'pass brain/acme/alpha/ signal',
      'pass brain/acme/alpha/ signal',
      'pass brain/acme/alpha/ signal',
    ]);
  });
});

describe('the follower of the brains, when a read fails', () => {
  it('says a read that failed at its start or while it waits is trouble, and reads again at the next sweep', async () => {
    const watched = followerWith([], { sweepEveryMs: 20, atStart: 1, nextScheduleAt: 1 });

    const log = await logReaching(watched, 6);

    expect(log.slice(0, 6)).toEqual([
      'The follower of the brains could not find the brains at its start; it tries again at the next sweep',
      'start',
      'orgs',
      'sweep',
      'The next due time of the schedules could not be read; the follower waits for the next sweep',
      'orgs',
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
