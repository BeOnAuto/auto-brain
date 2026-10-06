import { appendSignalOf } from '@beonauto/ledger';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { systemClock } from '../loop/host-clock.ts';
import { until } from '../reaction-testing/until.ts';
import type { Sweep } from '../sweeps/brain-sweeps.ts';
import { startFollower } from './follower-loop.ts';
import type { PassEnd } from './record-steps.ts';

const anHour = 3_600_000;

const nothingToSweep: Sweep = { registries: [], brains: [], again: false };

interface Watched {
  readonly raise: (stream: string) => void;
  readonly log: () => readonly string[];
}

interface Following {
  readonly passEnds?: readonly (PassEnd | 'fails')[];
  readonly sweeps?: readonly Sweep[];
  readonly sweepEveryMs?: number;
  readonly startsFailing?: number;
  readonly schedulesFailing?: number;
}

function failingFirst<A>(times: number, read: Effect.Effect<A>): () => Effect.Effect<A> {
  const failures = { left: times };
  return () =>
    Effect.suspend(() => {
      failures.left -= 1;
      return failures.left < 0 ? read : Effect.die(new Error('The database is down'));
    });
}

function inTurn<A>(items: readonly A[], after: A): () => A {
  const taken = { next: 0 };
  return () => {
    const item = items[taken.next] ?? after;
    taken.next += 1;
    return item;
  };
}

function followerWith(following: Following = {}): Watched {
  const log: string[] = [];
  const logged = (line: string) =>
    Effect.sync(() => {
      log.push(line);
    });
  const appended = appendSignalOf();
  const passEnd = inTurn<PassEnd | 'fails'>(following.passEnds ?? [], 'caught_up');
  const sweep = inTurn(following.sweeps ?? [], nothingToSweep);
  const follower = startFollower({
    pass: (brainKey, mode) =>
      Effect.suspend(() => {
        const end = passEnd();
        return end === 'fails'
          ? Effect.die(new Error('The pass broke'))
          : Effect.as(logged(`pass ${brainKey} ${mode}`), end);
      }),
    discovery: {
      atStart: failingFirst(following.startsFailing ?? 0, logged('start')),
      registriesAppended: (registries) => logged(`registries ${registries.join(' ')}`),
      brainSeen: () => Effect.void,
    },
    sweeps: { started: () => logged('anchored'), next: () => Effect.sync(sweep) },
    upkeep: {
      sweep: () => logged('sweep'),
      fireSchedules: () => Effect.void,
      nextScheduleAt: failingFirst(following.schedulesFailing ?? 0, Effect.succeed(null)),
    },
    appended,
    clock: systemClock,
    pace: systemClock,
    sweepEveryMs: following.sweepEveryMs ?? anHour,
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
  it('takes its place in the ledger and finds the brains at its start, sweeps, and reads a registry appended to', async () => {
    const watched = followerWith();
    await logReaching(watched, 3);

    watched.raise('org/acme/brains');
    const log = await logReaching(watched, 4);

    expect(log).toEqual(['anchored', 'start', 'sweep', 'registries org/acme/brains']);
  });

  it('passes a brain an event was appended to, not one a run appended to, and again while the pass says there is more', async () => {
    const watched = followerWith({ passEnds: ['more', 'more', 'caught_up'] });
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

  it('reads the registries a sweep names, passes the brains it hands out, and sweeps again at once when it says so', async () => {
    const handedOut: Sweep = {
      registries: ['org/acme/brains'],
      brains: [{ brainKey: 'brain/acme/alpha/', known: undefined }],
      again: true,
    };
    const watched = followerWith({ sweeps: [handedOut] });

    const log = await logReaching(watched, 6);

    expect(log).toEqual([
      'anchored',
      'start',
      'registries org/acme/brains',
      'sweep',
      'pass brain/acme/alpha/ sweep',
      'sweep',
    ]);
  });
});

describe('the follower of the brains, when a read fails', () => {
  it('says a read that failed at its start or while it waits is trouble, and reads again at the next sweep', async () => {
    const watched = followerWith({ sweepEveryMs: 20, startsFailing: 1, schedulesFailing: 1 });

    const log = await logReaching(watched, 7);

    expect(log.slice(0, 7)).toEqual([
      'anchored',
      'The follower of the brains could not find the brains at its start; it tries again at the next sweep',
      'anchored',
      'start',
      'sweep',
      'The next due time of the schedules could not be read; the follower waits for the next sweep',
      'sweep',
    ]);
  });

  it('says a pass that fails is trouble, and passes again at the next signal', async () => {
    const watched = followerWith({ passEnds: ['fails'] });
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
