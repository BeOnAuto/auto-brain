import { streamPrefixOfBrain, type RunOutcomeMapping, type RunOutcomesReader } from '@beonauto/operations';
import { Effect } from 'effect';

import type { RunOutcomesStore } from '../event-store.ts';

export function keptOutcomesOnly(
  mapping: RunOutcomeMapping | undefined,
  read: RunOutcomesStore['readRunOutcomes'],
): RunOutcomesStore['readRunOutcomes'] {
  return mapping === undefined ? () => Promise.resolve([]) : read;
}

export function runOutcomesReaderOf(store: RunOutcomesStore): RunOutcomesReader['readRunOutcomes'] {
  return (brain, window, selection) =>
    Effect.promise(() => store.readRunOutcomes(streamPrefixOfBrain(brain), window, selection));
}
