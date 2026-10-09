import type { AppendedStreams } from '@beonauto/ledger';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FollowedBrain, FollowedBrains } from '../follower/followed-brains.ts';
import { brainSweepsOn, brainsInASweep, waitingInASweep, type Sweep } from './brain-sweeps.ts';

interface Swept {
  readonly sweeps: readonly Sweep[];
  readonly readsAfter: readonly (readonly string[] | undefined)[];
}

interface Ledger {
  readonly appended: readonly AppendedStreams[];
  readonly waiting?: readonly FollowedBrain[];
  readonly followed?: readonly FollowedBrain[];
}

function brainNamed(index: number): string {
  return `brain/acme/b${String(index).padStart(4, '0')}/`;
}

function followedBrain(brainKey: string, waiting: boolean): FollowedBrain {
  return { brainKey, cursor: null, delivered: null, attempts: waiting ? 1 : 0, waiting };
}

function brainsNumbered(count: number, waiting: boolean): readonly FollowedBrain[] {
  return Array.from({ length: count }, (_, index) => followedBrain(brainNamed(index), waiting));
}

function followedOf({ waiting = [], followed = [] }: Ledger): FollowedBrains {
  return {
    follow: () => Effect.void,
    load: () => Effect.die(new Error('The sweeps load no brain')),
    save: () => Effect.void,
    waitingForASweep: (limit) => Effect.succeed(waiting.slice(0, limit)),
    following: (after, limit) => Effect.succeed(followed.filter(({ brainKey }) => brainKey > after).slice(0, limit)),
  };
}

async function sweptOver(ledger: Ledger, sweeps: number): Promise<Swept> {
  const readsAfter: (readonly string[] | undefined)[] = [];
  const answers = { next: 0 };
  const store = {
    readAppended: (after: readonly string[] | undefined) => {
      readsAfter.push(after);
      const answer = ledger.appended[answers.next] ?? { streams: [], through: [String(answers.next)], more: false };
      answers.next += 1;
      return Promise.resolve(answer);
    },
  };
  const brainSweeps = brainSweepsOn(store, followedOf(ledger));
  await Effect.runPromise(brainSweeps.started());
  const swept = await Effect.runPromise(
    Effect.forEach(Array.from({ length: sweeps }), () =>
      Effect.tap(brainSweeps.next(), (sweep) =>
        Effect.sync(() => {
          brainSweeps.registriesRead(sweep.registries);
        }),
      ),
    ),
  );
  return { sweeps: swept, readsAfter };
}

function keysOf(sweep: Sweep | undefined): readonly string[] {
  return (sweep?.brains ?? []).map(({ brainKey }) => brainKey);
}

const now: AppendedStreams = { streams: [], through: ['10'], more: false };

describe('the sweeps of the follower', () => {
  it('hand out each brain appended to since the last read once, but not one only a run appended to, and name the registries', async () => {
    const appended: AppendedStreams = {
      streams: [
        'brain/acme/alpha/events/',
        'brain/acme/alpha/definitions/',
        'brain/acme/beta/run-logs/',
        'org/acme/brains',
        'org/acme/keys/k1',
        'workflow/elsewhere',
      ],
      through: ['20'],
      more: false,
    };

    const { sweeps, readsAfter } = await sweptOver({ appended: [now, appended] }, 2);

    expect(sweeps).toEqual([
      { registries: ['org/acme/brains'], brains: [{ brainKey: 'brain/acme/alpha/', known: undefined }], again: false },
      { registries: [], brains: [], again: false },
    ]);
    expect(readsAfter).toEqual([undefined, ['10'], ['20']]);
  });

  it('keep half of a sweep for brains that wait, and the rest for brains appended to, the others at the next sweep', async () => {
    const changed = Array.from({ length: 100 }, (_, index) => `brain/acme/c${String(index).padStart(4, '0')}/events/`);
    const appended: AppendedStreams = { streams: changed, through: ['20'], more: false };

    const { sweeps } = await sweptOver({ appended: [now, appended], waiting: brainsNumbered(200, true) }, 2);

    expect(sweeps.map((sweep) => [sweep.brains.length, sweep.again])).toEqual([
      [brainsInASweep, true],
      [waitingInASweep + 36, false],
    ]);
    expect(sweeps[0]?.brains.filter(({ known }) => known?.waiting === true)).toHaveLength(waitingInASweep);
    expect(keysOf(sweeps[1]).at(-1)).toBe('brain/acme/c0099/');
  });
});

describe('the sweeps of the follower after its start', () => {
  it('go once over every brain followed at their start, as many at a sweep as there is room for', async () => {
    const { sweeps } = await sweptOver({ appended: [now], followed: brainsNumbered(200, false) }, 3);

    expect(sweeps.map((sweep) => sweep.brains.length)).toEqual([brainsInASweep, 200 - brainsInASweep, 0]);
    expect(keysOf(sweeps[1])[0]).toBe(brainNamed(brainsInASweep));
  });

  it('sweep again at once while the read of what was appended stopped at its most', async () => {
    const appended: AppendedStreams = { streams: ['brain/acme/alpha/events/'], through: ['15'], more: true };

    const { sweeps } = await sweptOver({ appended: [now, appended] }, 1);

    expect(sweeps[0]?.again).toBe(true);
  });
});

function answering(answers: readonly AppendedStreams[]) {
  const reads = { count: 0 };
  return {
    readAppended: () => {
      const answer = answers[Math.min(reads.count, answers.length - 1)] ?? now;
      reads.count += 1;
      return Promise.resolve(answer);
    },
  };
}

function followingFailingOnce(): FollowedBrains {
  const failures = { left: 1 };
  return {
    ...followedOf({ appended: [] }),
    following: () =>
      Effect.suspend(() => {
        failures.left -= 1;
        return failures.left < 0 ? Effect.succeed([]) : Effect.die(new Error('The brains could not be read'));
      }),
  };
}

const quiet: AppendedStreams = { streams: [], through: ['30'], more: false };

function loadOf(sweep: number): AppendedStreams {
  return {
    streams: Array.from({ length: 200 }, (_, index) => `brain/acme/s${sweep}b${index}/events/`),
    through: [String(sweep)],
    more: false,
  };
}

describe('the sweeps of the follower when a read fails', () => {
  it('keep the brains they chose when the read of the round fails, and hand them out at the next sweep', async () => {
    const appended: AppendedStreams = { streams: ['brain/acme/alpha/events/'], through: ['20'], more: false };
    const brainSweeps = brainSweepsOn(answering([now, appended, quiet]), followingFailingOnce());
    await Effect.runPromise(brainSweeps.started());

    const failed = await Effect.runPromiseExit(brainSweeps.next());
    const next = await Effect.runPromise(brainSweeps.next());

    expect(Exit.isFailure(failed)).toBe(true);
    expect(keysOf(next)).toEqual(['brain/acme/alpha/']);
  });

  it('name a registry again at every sweep until it was read', async () => {
    const appended: AppendedStreams = { streams: ['org/acme/brains'], through: ['20'], more: false };
    const brainSweeps = brainSweepsOn(answering([now, appended, quiet]), followedOf({ appended: [] }));
    await Effect.runPromise(brainSweeps.started());

    const first = await Effect.runPromise(brainSweeps.next());
    const unread = await Effect.runPromise(brainSweeps.next());
    brainSweeps.registriesRead(unread.registries);
    const read = await Effect.runPromise(brainSweeps.next());

    expect([first.registries, unread.registries, read.registries]).toEqual([
      ['org/acme/brains'],
      ['org/acme/brains'],
      [],
    ]);
  });
});

describe('the sweeps of the follower under a steady load', () => {
  it('pass a failed brain within a few sweeps though 200 brains are appended to before each', async () => {
    const loads = Array.from({ length: 8 }, (_, sweep) => loadOf(sweep));
    const brainSweeps = brainSweepsOn(answering(loads), followedOf({ appended: [] }));
    await Effect.runPromise(brainSweeps.started());
    await Effect.runPromise(brainSweeps.next());
    brainSweeps.passAgain('brain/acme/failed/');

    const sweeps = await Effect.runPromise(Effect.forEach(Array.from({ length: 5 }), () => brainSweeps.next()));
    const passedAt = sweeps.findIndex((sweep) => keysOf(sweep).includes('brain/acme/failed/'));

    expect(passedAt).toBeGreaterThanOrEqual(0);
    expect(passedAt).toBeLessThan(3);
  });
});
