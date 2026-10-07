import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryDriver } from '../testing/memory-driver.ts';
import { workflow } from '../testing/workflows.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-000000000071';

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

function cancelledWhileItAsks(failing: 'cancel_call' | 'settle') {
  const driver = memoryDriver({ respond: () => 'never' });
  driver.start({ executionId, document: asking });
  driver.ports.faults.failNext(failing);
  driver.cancel(executionId);
  return {
    watermark: Effect.runSync(driver.ports.watermark.read(executionId)),
    settled: driver.ports.recordStore.settlementOf(executionId),
  };
}

describe('the outputs of a run that has ended', () => {
  it('pass a cancel of a call that fails, so the settlement after it is made and the dispatch moves on', () => {
    expect(cancelledWhileItAsks('cancel_call')).toMatchObject({ watermark: 2, settled: { status: 'rejected' } });
  });

  it('stop at a settlement that fails, which is never passed', () => {
    expect(cancelledWhileItAsks('settle')).toEqual({ watermark: 1, settled: undefined });
  });
});

describe('the outputs of a run still going', () => {
  it('stop at a start of a call that fails, which is dispatched again', () => {
    const driver = memoryDriver({ respond: () => 'never' });
    driver.ports.faults.failNext('start_call');
    driver.start({ executionId, document: asking });

    expect(Effect.runSync(driver.ports.watermark.read(executionId))).toBe(0);
    expect(Effect.runSync(driver.engine.wake(executionId))).toEqual({ version: 1, dispatchedThrough: 1 });
  });
});
