import type { BrainDefinitions } from './brain-definitions.ts';

export interface Schedule {
  readonly definitions: Map<string, BrainDefinitions>;
  readonly want: (brain: string) => void;
  readonly wanted: () => readonly string[];
  readonly discover: () => void;
  readonly discoveryDue: () => boolean;
  readonly sweepDue: (now: number) => boolean;
  readonly swept: (now: number) => void;
  readonly untilSweep: (now: number) => number;
  readonly idle: () => boolean;
  readonly woken: () => Promise<void>;
  readonly wake: () => void;
}

export function scheduleOf(sweepEveryMs: number): Schedule {
  const wanted = new Set<string>();
  const state = { discoveryDue: true, lastSweptAt: Number.NEGATIVE_INFINITY, wake: Promise.withResolvers<void>() };
  return {
    definitions: new Map(),
    want: (brain) => {
      wanted.add(brain);
    },
    wanted: () => {
      const brains = [...wanted];
      wanted.clear();
      return brains;
    },
    discover: () => {
      state.discoveryDue = true;
    },
    discoveryDue: () => {
      const due = state.discoveryDue;
      state.discoveryDue = false;
      return due;
    },
    sweepDue: (now) => now >= state.lastSweptAt + sweepEveryMs,
    swept: (now) => {
      state.lastSweptAt = now;
    },
    untilSweep: (now) => Math.max(0, state.lastSweptAt + sweepEveryMs - now),
    idle: () => wanted.size === 0 && !state.discoveryDue,
    woken: () => {
      state.wake = Promise.withResolvers<void>();
      return state.wake.promise;
    },
    wake: () => {
      state.wake.resolve();
    },
  };
}
