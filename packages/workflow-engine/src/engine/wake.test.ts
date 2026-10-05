import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { testMachine } from '../testing/driver-inputs.ts';
import { memoryDriver } from '../testing/memory-driver.ts';
import { memoryPorts } from '../testing/memory-ports.ts';
import { virtualClock } from '../testing/virtual-clock.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowEngineOf } from './engine.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausing = workflow('do:\n  - pause: { wait: PT1M }');

describe('a wake', () => {
  it('dispatches again, and notes the run due, a dispatch whose note of the due time failed', () => {
    const driver = memoryDriver();
    driver.ports.faults.failNext('note_due');
    driver.start({ executionId, document: pausing });
    driver.ports.timers.forget();

    const sweptBefore = Effect.runSync(driver.engine.sweep(driver.clock.now() + 3_600_000));
    const woken = Effect.runSync(driver.engine.wake(executionId));
    const sweptAfter = Effect.runSync(driver.engine.sweep(driver.clock.now() + 3_600_000));

    expect(sweptBefore).toEqual({ runs: 0, timersArmedAgain: 0 });
    expect(woken).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(sweptAfter).toEqual({ runs: 1, timersArmedAgain: 0 });
    expect(driver.runUntilEnded(executionId).outcome).toEqual({ kind: 'completed', output: {} });
  });

  it('reads and moves the watermark of the run it was asked to wake, even one that has no event', () => {
    const asked: string[] = [];
    const clock = virtualClock();
    const ports = memoryPorts(
      clock,
      (input) => {
        asked.push(`submitted ${input.kind}`);
      },
      () => 'never',
    );
    const watermark = {
      read: (id: string) => Effect.sync(() => asked.push(`read ${id}`)).pipe(Effect.as(0)),
      advance: (id: string, through: number) =>
        Effect.sync(() => {
          asked.push(`advance ${id} ${through}`);
        }),
    };
    const engine = workflowEngineOf({ ...ports, watermark }, testMachine);

    expect(Effect.runSync(engine.wake('a-run-with-no-events'))).toEqual({ version: 0, dispatchedThrough: 0 });
    expect(asked).toEqual(['read a-run-with-no-events', 'advance a-run-with-no-events 0']);
  });
});
