import type { PlaybookDefinitions } from './brain-definitions.ts';
import type { Resting } from './brain-pass.ts';

export interface Schedule {
  readonly definitions: Map<string, PlaybookDefinitions>;
  readonly want: (playbook: string) => void;
  readonly wanted: () => readonly string[];
  readonly discover: () => void;
  readonly discoveryDue: () => boolean;
  readonly sweepDue: (now: number) => boolean;
  readonly swept: (now: number) => void;
  readonly untilSweep: (now: number) => number;
  readonly idle: () => boolean;
  readonly woken: () => Promise<void>;
  readonly wake: () => void;
  readonly resting: Resting;
}

function keyOf(playbook: string, name: string): string {
  return JSON.stringify([playbook, name]);
}

function restingUntilSwept(): Resting & { readonly wakeAll: () => void } {
  const resting = new Set<string>();
  return {
    isResting: (playbook, name) => resting.has(keyOf(playbook, name)),
    rest: (playbook, name) => {
      resting.add(keyOf(playbook, name));
    },
    wakeAll: () => {
      resting.clear();
    },
  };
}

export function scheduleOf(sweepEveryMs: number): Schedule {
  const wanted = new Set<string>();
  const resting = restingUntilSwept();
  const state = { discoveryDue: true, lastSweptAt: Number.NEGATIVE_INFINITY, wake: Promise.withResolvers<void>() };
  return {
    definitions: new Map(),
    want: (playbook) => {
      wanted.add(playbook);
    },
    wanted: () => {
      const playbooks = [...wanted];
      wanted.clear();
      return playbooks;
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
      resting.wakeAll();
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
    resting,
  };
}
