import { streamPrefixOfBrain, type RunOutcomesReader } from '@beonauto/operations';
import { Effect } from 'effect';

import type { RunOutcomesStore } from '../event-store.ts';

export function runOutcomesReaderOf(store: RunOutcomesStore): RunOutcomesReader['readRunOutcomes'] {
  return (brain, window, selection) =>
    Effect.promise(() => store.readRunOutcomes(streamPrefixOfBrain(brain), window, selection));
}
