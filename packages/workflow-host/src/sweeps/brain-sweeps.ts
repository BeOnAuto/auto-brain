import type { AppendedStreams, EventStore } from '@beonauto/ledger';
import { Effect } from 'effect';

import { isOrgRegistry } from '../follower/brain-discovery.ts';
import type { FollowedBrain, FollowedBrains } from '../follower/followed-brains.ts';
import { followedBrainOf } from './wakes.ts';

interface SweptBrain {
  readonly brainKey: string;
  readonly known: FollowedBrain | undefined;
}

export interface Sweep {
  readonly registries: readonly string[];
  readonly brains: readonly SweptBrain[];
  readonly again: boolean;
}

export interface BrainSweeps {
  readonly started: () => Effect.Effect<void>;
  readonly next: () => Effect.Effect<Sweep>;
  readonly passAgain: (brainKey: string) => void;
}

export const brainsInASweep = 128;

export const waitingInASweep = 64;

const messagesReadInASweep = 10_000;

interface Round {
  readonly after: string | null;
  readonly brains: readonly SweptBrain[];
}

function sweptOf(known: FollowedBrain): SweptBrain {
  return { brainKey: known.brainKey, known };
}

function addedTo(
  chosen: ReadonlyMap<string, SweptBrain>,
  brains: readonly SweptBrain[],
): ReadonlyMap<string, SweptBrain> {
  const added = brains.filter(({ brainKey }) => !chosen.has(brainKey));
  return new Map([...chosen, ...added.map((brain): [string, SweptBrain] => [brain.brainKey, brain])]);
}

function roundGoneOn(brains: FollowedBrains, after: string | null, room: number): Effect.Effect<Round> {
  if (after === null || room <= 0) {
    return Effect.succeed({ after, brains: [] });
  }
  return Effect.map(brains.following(after, room), (followed) => {
    const last = followed.at(-1);
    return {
      after: last === undefined || followed.length < room ? null : last.brainKey,
      brains: followed.map((known) => sweptOf(known)),
    };
  });
}

function pendingBrains() {
  const pending = new Set<string>();
  const failed = new Set<string>();
  return {
    appended: (brainKeys: readonly string[]) => {
      for (const brainKey of brainKeys) {
        pending.add(brainKey);
      }
    },
    failed: (brainKey: string) => {
      failed.add(brainKey);
    },
    chosen: (room: number): readonly SweptBrain[] =>
      [...new Set([...pending, ...failed])].slice(0, room).map((brainKey) => ({ brainKey, known: undefined })),
    taken: (chosen: readonly SweptBrain[]) => {
      for (const { brainKey } of chosen) {
        pending.delete(brainKey);
        failed.delete(brainKey);
      }
    },
    left: () => pending.size > 0,
  };
}

export function brainSweepsOn(store: Pick<EventStore, 'readAppended'>, brains: FollowedBrains): BrainSweeps {
  const state: { through: AppendedStreams['through'] | undefined; round: string | null } = {
    through: undefined,
    round: null,
  };
  const pending = pendingBrains();
  const appendedSince = (most: number) =>
    Effect.tap(
      Effect.promise(() => store.readAppended(state.through, most)),
      (appended) =>
        Effect.sync(() => {
          state.through = appended.through;
          pending.appended(appended.streams.flatMap((stream) => followedBrainOf(stream) ?? []));
        }),
    );
  return {
    started: () =>
      Effect.andThen(appendedSince(0), () =>
        Effect.sync(() => {
          state.round = '';
        }),
      ),
    passAgain: pending.failed,
    next: () =>
      Effect.gen(function* () {
        const appended = yield* appendedSince(messagesReadInASweep);
        const waiting = (yield* brains.waitingForASweep(waitingInASweep)).map((known) => sweptOf(known));
        const chosen = pending.chosen(brainsInASweep - waiting.length);
        const changed = addedTo(new Map(), [...waiting, ...chosen]);
        const round = yield* roundGoneOn(brains, state.round, brainsInASweep - changed.size);
        pending.taken(chosen);
        state.round = round.after;
        return {
          registries: appended.streams.filter((stream) => isOrgRegistry(stream)),
          brains: [...addedTo(changed, round.brains).values()],
          again: appended.more || pending.left(),
        };
      }),
  };
}
