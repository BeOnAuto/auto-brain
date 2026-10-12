import type { Resting } from './folder-pass.ts';
import type { PlaybookDefinitions } from './playbook-definitions.ts';
import type { KeptDefinitions } from './reconciled-rows.ts';

export interface DefinitionsByType {
  readonly of: KeptDefinitions;
  readonly knows: (playbook: string) => boolean;
}

export interface Schedule {
  readonly definitions: DefinitionsByType;
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

function keyOf(playbook: string, row: string): string {
  return JSON.stringify([playbook, row]);
}

function restingUntilSwept(): Resting & { readonly wakeAll: () => void } {
  const resting = new Set<string>();
  return {
    isResting: (playbook, row) => resting.has(keyOf(playbook, row)),
    rest: (playbook, row) => {
      resting.add(keyOf(playbook, row));
    },
    wakeAll: () => {
      resting.clear();
    },
  };
}

export function definitionsByType(): DefinitionsByType {
  const byType = new Map<string, Map<string, PlaybookDefinitions>>();
  return {
    of: (definitionType) => {
      const kept = byType.get(definitionType) ?? new Map<string, PlaybookDefinitions>();
      byType.set(definitionType, kept);
      return kept;
    },
    knows: (playbook) => [...byType.values()].some((kept) => kept.has(playbook)),
  };
}

export function scheduleOf(sweepEveryMs: number): Schedule {
  const wanted = new Set<string>();
  const resting = restingUntilSwept();
  const state = { discoveryDue: true, lastSweptAt: Number.NEGATIVE_INFINITY, wake: Promise.withResolvers<void>() };
  return {
    definitions: definitionsByType(),
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
