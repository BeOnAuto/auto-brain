import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowMachine } from '../decider/workflow-machine.ts';
import type { RunInput } from '../machine/run-input.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import { testMachine } from '../testing/driver-inputs.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { armedTimerIds, drivenExecutionId, statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const elsewhere = { cause: { kind: 'none' as const }, attributes: {} };

function appendedElsewhere(driver: MemoryDriver, events: readonly RunEvent[]): void {
  Effect.runSync(
    Effect.forEach(events, (event) => driver.ports.runStore.append(drivenExecutionId, event, 1, elsewhere)),
  );
}

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

function storedState(driver: MemoryDriver): RunState {
  return statesAlong(driver.ports.runStore.events(drivenExecutionId)).at(-1) ?? newRun;
}

function decidedElsewhere(driver: MemoryDriver, input: RunInput): readonly RunEvent[] {
  return Result.getOrThrow(workflowMachine(testMachine).decide(input, storedState(driver)));
}

function armedTick(driver: MemoryDriver): string {
  const [timerId = ''] = armedTimerIds(storedState(driver), 'wait');
  return timerId;
}

function fired(timerId: string, at: number): RunInput {
  return { kind: 'timer_fired', executionId: drivenExecutionId, at, timerId };
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
    appendedElsewhere(driver, written);

    const answer = driver.submit({ ...cancel, at: cancel.at + 1 });

    expect(answer).toEqual({ outcome: 'stale', version: 2 });
    expect(driver.ports.runStore.loads(drivenExecutionId)).toBe(2);
  });

  it('takes an input another host made possible, since its stream moved past the version the engine keeps', () => {
    const driver = startedTicking(3);
    const firstTick = armedTick(driver);
    const written = decidedElsewhere(driver, fired(firstTick, driver.clock.now() + 1000));
    appendedElsewhere(driver, written);
    const secondTick = armedTick(driver);

    const answer = driver.submit(fired(secondTick, driver.clock.now() + 2000));

    expect(secondTick).not.toBe(firstTick);
    expect(answer).toEqual({ outcome: 'applied', version: 3 });
    expect(driver.ports.runStore.events(drivenExecutionId)).toHaveLength(3);
  });

  it('loads the run from the store when its append meets a conflict, rather than decide again on what it kept', () => {
    const driver = startedTicking(3);
    driver.ports.runStore.failNextAppend('conflict');

    const answer = driver.cancel(drivenExecutionId);

    expect(answer).toEqual({ outcome: 'applied', version: 2 });
    expect(driver.ports.runStore.loads(drivenExecutionId)).toBe(2);
  });
});
