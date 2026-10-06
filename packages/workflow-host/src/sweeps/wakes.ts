import { brainKeyOfStream } from '@beonauto/ledger';

import { isOrgRegistry } from '../follower/brain-discovery.ts';

export interface Wakes {
  readonly woken: (stream: string) => void;
  readonly brainAgain: (brainKey: string) => void;
  readonly brainsWoken: () => readonly string[];
  readonly registriesWoken: () => readonly string[];
  readonly anyWoken: () => boolean;
  readonly nextSignal: () => Promise<void>;
  readonly sweepDue: (now: number) => boolean;
  readonly sweepSoon: () => void;
  readonly nextSweepAt: () => number;
}

export function followedBrainOf(stream: string): string | undefined {
  const brainKey = brainKeyOfStream(stream);
  return brainKey === undefined || stream.startsWith(`${brainKey}runs/`) ? undefined : brainKey;
}

function takenFrom(keys: Set<string>): readonly string[] {
  const taken = [...keys];
  keys.clear();
  return taken;
}

export function wakesOf(sweepEveryMs: number): Wakes {
  const brains = new Set<string>();
  const registries = new Set<string>();
  const state = { signal: Promise.withResolvers<void>(), lastSweptAt: 0 };
  return {
    woken: (stream) => {
      const brainKey = followedBrainOf(stream);
      if (brainKey !== undefined) {
        brains.add(brainKey);
      }
      if (isOrgRegistry(stream)) {
        registries.add(stream);
      }
      state.signal.resolve();
    },
    brainAgain: (brainKey) => {
      brains.add(brainKey);
    },
    brainsWoken: () => takenFrom(brains),
    registriesWoken: () => takenFrom(registries),
    anyWoken: () => brains.size > 0 || registries.size > 0,
    nextSignal: () => {
      state.signal = Promise.withResolvers();
      return state.signal.promise;
    },
    sweepDue: (now) => {
      const due = now >= state.lastSweptAt + sweepEveryMs;
      state.lastSweptAt = due ? now : state.lastSweptAt;
      return due;
    },
    sweepSoon: () => {
      state.lastSweptAt = Number.NEGATIVE_INFINITY;
    },
    nextSweepAt: () => state.lastSweptAt + sweepEveryMs,
  };
}
