import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { executionId } from '../testing/runs.ts';
import { runStoreProbes } from '../testing/store-probes.ts';
import { memoryRunStore } from './run-store.ts';

describe('the memory run store meets the contract every run store meets', () => {
  it.each(runStoreProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run({ runStore: memoryRunStore(), executionId }))).toEqual(probe.expected);
  });
});
