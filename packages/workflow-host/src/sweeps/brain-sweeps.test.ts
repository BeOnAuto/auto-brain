import type { AppendedStreams } from '@beonauto/ledger';
import { Effect } from 'effect';
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
  const swept = await Effect.runPromise(Effect.forEach(Array.from({ length: sweeps }), () => brainSweeps.next()));
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
        'brain/acme/alpha/specs/',
        'brain/acme/beta/runs/',
        'org/acme/brains',
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
