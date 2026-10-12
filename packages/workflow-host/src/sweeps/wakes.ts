import { playbookKeyOfStream } from '@beonauto/ledger';
import { streamPrefixOfPlaybook } from '@beonauto/operations';

import { isOrgRegistry } from '../follower/playbook-discovery.ts';
import { playbookOfKey } from '../follower/record-steps.ts';

export interface Wakes {
  readonly woken: (stream: string) => void;
  readonly playbookAgain: (playbookKey: string) => void;
  readonly playbooksWoken: () => readonly string[];
  readonly registriesWoken: () => readonly string[];
  readonly anyWoken: () => boolean;
  readonly nextSignal: () => Promise<void>;
  readonly sweepDue: (now: number) => boolean;
  readonly sweepSoon: () => void;
  readonly nextSweepAt: () => number;
}

function isPlaybookKey(playbookKey: string): boolean {
  return streamPrefixOfPlaybook(playbookOfKey(playbookKey)) === playbookKey;
}

export function followedPlaybookOf(stream: string): string | undefined {
  const playbookKey = playbookKeyOfStream(stream);
  return playbookKey === undefined || !isPlaybookKey(playbookKey) || stream.startsWith(`${playbookKey}run-logs/`)
    ? undefined
    : playbookKey;
}

function takenFrom(keys: Set<string>): readonly string[] {
  const taken = [...keys];
  keys.clear();
  return taken;
}

export function wakesOf(sweepEveryMs: number): Wakes {
  const playbooks = new Set<string>();
  const registries = new Set<string>();
  const state = { signal: Promise.withResolvers<void>(), lastSweptAt: 0 };
  return {
    woken: (stream) => {
      const playbookKey = followedPlaybookOf(stream);
      if (playbookKey !== undefined) {
        playbooks.add(playbookKey);
      }
      if (isOrgRegistry(stream)) {
        registries.add(stream);
      }
      state.signal.resolve();
    },
    playbookAgain: (playbookKey) => {
      playbooks.add(playbookKey);
    },
    playbooksWoken: () => takenFrom(playbooks),
    registriesWoken: () => takenFrom(registries),
    anyWoken: () => playbooks.size > 0 || registries.size > 0,
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
