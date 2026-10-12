import type { BrainDefinitions } from './brain-definitions.ts';
import type { Resting } from './folder-pass.ts';
import type { KeptDefinitions } from './reconciled-rows.ts';

export interface DefinitionsByType {
  readonly of: KeptDefinitions;
  readonly knows: (brain: string) => boolean;
}

export interface Schedule {
  readonly definitions: DefinitionsByType;
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
  readonly resting: Resting;
}

function keyOf(brain: string, row: string): string {
  return JSON.stringify([brain, row]);
}

function restingUntilSwept(): Resting & { readonly wakeAll: () => void } {
  const resting = new Set<string>();
  return {
    isResting: (brain, row) => resting.has(keyOf(brain, row)),
    rest: (brain, row) => {
      resting.add(keyOf(brain, row));
    },
    wakeAll: () => {
      resting.clear();
    },
  };
}

export function definitionsByType(): DefinitionsByType {
  const byType = new Map<string, Map<string, BrainDefinitions>>();
  return {
    of: (definitionType) => {
      const kept = byType.get(definitionType) ?? new Map<string, BrainDefinitions>();
      byType.set(definitionType, kept);
      return kept;
    },
    knows: (brain) => [...byType.values()].some((kept) => kept.has(brain)),
  };
}

export function scheduleOf(sweepEveryMs: number): Schedule {
  const wanted = new Set<string>();
  const resting = restingUntilSwept();
  const state = { discoveryDue: true, lastSweptAt: Number.NEGATIVE_INFINITY, wake: Promise.withResolvers<void>() };
  return {
    definitions: definitionsByType(),
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
