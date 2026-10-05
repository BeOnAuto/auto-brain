import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowMachine } from '../decider/workflow-machine.ts';
import type { RunInput } from '../machine/run-input.ts';
import { newRun } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import { testMachine } from '../testing/driver-inputs.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { drivenExecutionId, statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

function ticking(times: number): ReturnType<typeof workflow> {
  return workflow(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ { n: ((.n // 0) + 1) } }' }
  - again: { switch: [{ more: { when: '\${ .n < ${times} }', then: tick } }] }
`);
}

function startedTicking(times: number): MemoryDriver {
  const driver = memoryDriver();
  driver.start({ executionId: drivenExecutionId, document: ticking(times) });
  return driver;
}

function advancedToTheEnd(driver: MemoryDriver): void {
  let advancing = true;
  while (advancing) {
    advancing = driver.clock.advance();
  }
}

function decidedElsewhere(driver: MemoryDriver, input: RunInput): readonly RunEvent[] {
  const state = statesAlong(driver.ports.runStore.events(drivenExecutionId)).at(-1) ?? newRun;
  return Result.getOrThrow(workflowMachine(testMachine).decide(input, state));
}

describe('an input to a run the engine keeps', () => {
  it('loads neither the snapshot nor the events the inputs before it left', () => {
    const driver = startedTicking(20);
    advancedToTheEnd(driver);
    const events = driver.ports.runStore.events(drivenExecutionId);

    expect(statesAlong(events).at(-1)?.outcome).toEqual({ kind: 'completed', output: { n: 20 } });
    expect(events).toHaveLength(21);
    expect(driver.ports.runStore.loads(drivenExecutionId)).toBe(1);
  });

  it('loads the run again once its stream moved past the version the engine keeps', () => {
    const driver = startedTicking(3);
    const cancel: RunInput = { kind: 'cancel_requested', executionId: drivenExecutionId, at: driver.clock.now() };
    const written = decidedElsewhere(driver, cancel);
    Effect.runSync(Effect.forEach(written, (event) => driver.ports.runStore.append(drivenExecutionId, event, 1)));

    const answer = driver.submit({ ...cancel, at: cancel.at + 1 });

    expect(answer).toEqual({ outcome: 'stale', version: 2 });
    expect(driver.ports.runStore.loads(drivenExecutionId)).toBe(2);
  });

  it('loads the run from the store when its append meets a conflict, rather than decide again on what it kept', () => {
    const driver = startedTicking(3);
    driver.ports.runStore.failNextAppend('conflict');

    const answer = driver.cancel(drivenExecutionId);

    expect(answer).toEqual({ outcome: 'applied', version: 2 });
    expect(driver.ports.runStore.loads(drivenExecutionId)).toBe(2);
  });
});
