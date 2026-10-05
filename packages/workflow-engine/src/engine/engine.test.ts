import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { loadedRunOf } from '../run-log/run-fold.ts';
import { startedOf } from '../testing/driver-inputs.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { drivenExecutionId as executionId, outputKindsIn, statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const answeringLarge = () => ({ after: 1000, result: { status: 'succeeded', output: 'x'.repeat(300_000) } }) as const;

const callingInALoop = workflow(`
do:
  - each:
      for: { in: '\${ [1, 2, 3, 4, 5, 6, 7, 8] }' }
      do:
        - ask: { call: notify, with: { to: ada }, output: { as: '\${ { last: . } }' } }
  - done: { set: { done: true } }
`);

function snapshotVersionOf(driver: MemoryDriver): number {
  return driver.ports.runStore.snapshotOf(executionId)?.snapshot.version ?? 0;
}

function untilTheFirstSnapshot(driver: MemoryDriver): number {
  return snapshotVersionOf(driver) === 0 && driver.clock.advance()
    ? untilTheFirstSnapshot(driver)
    : snapshotVersionOf(driver);
}

describe('the snapshots of a run', () => {
  it('are saved once the events since the last take as many bytes, and give the state its whole stream gives', () => {
    const driver = memoryDriver({ respond: answeringLarge });
    driver.start({ executionId, document: callingInALoop });

    const ended = driver.runUntilEnded(executionId);
    const events = driver.ports.runStore.events(executionId);
    const fromSnapshot = loadedRunOf(Effect.runSync(driver.ports.runStore.load(executionId)));

    expect(ended.outcome).toEqual({ kind: 'completed', output: { done: true } });
    expect(snapshotVersionOf(driver)).toBeGreaterThan(1);
    expect(snapshotVersionOf(driver)).toBeLessThan(events.length);
    expect(fromSnapshot.state).toEqual(statesAlong(events).at(-1));
    expect(fromSnapshot.version).toBe(events.length);
  });

  it('let the input that follows one be decided from it alone', () => {
    const driver = memoryDriver({ respond: answeringLarge });
    driver.start({ executionId, document: callingInALoop });
    const snapshotAt = untilTheFirstSnapshot(driver);

    expect(Effect.runSync(driver.ports.runStore.load(executionId)).tail).toEqual([]);
    expect(driver.runUntilEnded(executionId).outcome).toEqual({ kind: 'completed', output: { done: true } });
    expect(driver.ports.runStore.events(executionId).length).toBeGreaterThan(snapshotAt);
  });
});

describe('the dispatch of a run', () => {
  it('sends again, with the next input, the outputs of an event whose dispatch stopped before they went out', () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - pause: { wait: PT1M }
          - await: { listen: { to: { one: { with: { type: go } } } } }
`);
    const driver = memoryDriver();
    driver.ports.faults.failNext('arm_timer');
    driver.start({ executionId, document });
    const dispatchedBefore = driver.ports.faults.dispatched().length;
    driver.deliver(executionId, { id: 'e1', type: 'go' });

    expect(dispatchedBefore).toBe(0);
    expect(driver.runUntilEnded(executionId).outcome).toEqual({ kind: 'completed', output: [{}, [null]] });
  });

  it('settles again, when woken, a settlement whose dispatch failed', () => {
    const driver = memoryDriver();
    driver.ports.faults.failNext('settle');
    driver.start({ executionId, document: workflow('do:\n  - greet: { set: { done: true } }') });
    const before = driver.ports.recordStore.settlementOf(executionId);

    const woken = Effect.runSync(driver.engine.wake(executionId));

    expect(before).toBeUndefined();
    expect(woken).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(driver.ports.recordStore.settlementOf(executionId)).toEqual({ status: 'succeeded', output: { done: true } });
  });

  it('reports a settle receipt that troubles, and does not drop it', () => {
    const driver = memoryDriver();
    driver.submit(startedOf({ executionId, document: workflow('do:\n  - greet: { set: { done: true } }') }, 0));

    expect(driver.ports.reporter.reports()).toEqual([
      { run: { executionId, attributes: {} }, receipt: 'unknown_execution' },
    ]);
    expect(outputKindsIn(driver.ports.runStore.events(executionId))).toEqual(['settle']);
  });
});
