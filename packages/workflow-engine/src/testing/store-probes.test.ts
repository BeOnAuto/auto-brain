import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryRecordStore, memoryWatermark } from './memory-records.ts';
import { faultsOf } from './memory-timers.ts';
import { memoryRunStore } from './run-store.ts';
import { executionId } from './runs.ts';
import { recordStoreProbes, runStoreProbes, watermarkProbes, type RecordStoreSubject } from './store-probes.ts';
import { virtualClock } from './virtual-clock.ts';

function recordStoreSubject(): RecordStoreSubject {
  const recordStore = memoryRecordStore(faultsOf(virtualClock()));
  return {
    recordStore,
    run: { executionId, attributes: {} },
    know: (known) =>
      Effect.sync(() => {
        recordStore.known(known);
      }),
  };
}

describe('the memory record store meets the contract every record store meets', () => {
  it.each(recordStoreProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run(recordStoreSubject()))).toEqual(probe.expected);
  });
});

describe('the memory run store and watermark meet the contract every one meets', () => {
  it.each(runStoreProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run({ runStore: memoryRunStore(), executionId }))).toEqual(probe.expected);
  });

  it.each(watermarkProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run({ watermark: memoryWatermark(), executionId }))).toEqual(probe.expected);
  });
});
