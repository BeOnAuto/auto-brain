import { brainKeyOfStream } from '@beonauto/ledger';

import { isOrgRegistry } from './brain-discovery.ts';

export interface Wakes {
  readonly woken: (stream: string) => void;
  readonly brainAgain: (brainKey: string) => void;
  readonly brainsWoken: () => readonly string[];
  readonly orgsWoken: () => boolean;
  readonly anyWoken: () => boolean;
  readonly nextSignal: () => Promise<void>;
  readonly sweepDue: (now: number) => boolean;
  readonly nextSweepAt: () => number;
}

export function wakesOf(sweepEveryMs: number): Wakes {
  const brains = new Set<string>();
  const state = { orgs: false, signal: Promise.withResolvers<void>(), lastSweptAt: 0 };
  return {
    woken: (stream) => {
      const brainKey = brainKeyOfStream(stream);
      if (brainKey !== undefined) {
        brains.add(brainKey);
      }
      state.orgs ||= isOrgRegistry(stream);
      state.signal.resolve();
    },
    brainAgain: (brainKey) => {
      brains.add(brainKey);
    },
    brainsWoken: () => {
      const keys = [...brains];
      brains.clear();
      return keys;
    },
    orgsWoken: () => {
      const woken = state.orgs;
      state.orgs = false;
      return woken;
    },
    anyWoken: () => brains.size > 0 || state.orgs,
    nextSignal: () => {
      state.signal = Promise.withResolvers();
      return state.signal.promise;
    },
    sweepDue: (now) => {
      const due = now >= state.lastSweptAt + sweepEveryMs;
      state.lastSweptAt = due ? now : state.lastSweptAt;
      return due;
    },
    nextSweepAt: () => state.lastSweptAt + sweepEveryMs,
  };
}
