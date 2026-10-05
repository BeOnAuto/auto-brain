import { setImmediate } from 'node:timers/promises';

import type { CallResult } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callKeyText } from '../executor/call-key.ts';
import { memoryExecutor } from './memory-executor.ts';
import { faultsOf, memoryTimers, type Submit } from './memory-timers.ts';
import { executorProbes, timerProbes, type ExecutorSubject, type TimerSubject } from './port-probes.ts';
import { virtualClock, type VirtualClock } from './virtual-clock.ts';

const run = { executionId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes: {} };

async function settledOf(clock: VirtualClock, take: () => readonly string[]): Promise<readonly string[]> {
  await setImmediate();
  return clock.advance() ? settledOf(clock, take) : take();
}

function recorder(): { readonly submit: Submit; readonly take: () => readonly string[] } {
  const delivered: string[] = [];
  return {
    submit: (input) => {
      delivered.push(
        input.kind === 'call_answered' ? callKeyText(input.key) : `${input.kind} ${JSON.stringify(input)}`,
      );
    },
    take: () => delivered.splice(0),
  };
}

function timerSubject(): TimerSubject {
  const clock = virtualClock();
  const fired: string[] = [];
  const timers = memoryTimers(
    clock,
    (input) => {
      fired.push(input.kind === 'timer_fired' ? input.timerId : input.kind);
    },
    faultsOf(clock),
  );
  return { timers, run, now: clock.now, settle: () => Effect.promise(() => settledOf(clock, () => fired.splice(0))) };
}

function executorSubject(): ExecutorSubject {
  const clock = virtualClock();
  const delivered = recorder();
  const finishers = new Map<string, (result: CallResult) => void>();
  const later = (key: string): Promise<CallResult> =>
    new Promise((resolve) => {
      finishers.set(key, resolve);
    });
  const executor = memoryExecutor(
    clock,
    delivered.submit,
    (call) => ({ later: later(callKeyText(call.key)) }),
    faultsOf(clock),
  );
  return {
    executor,
    run,
    finish: (call, result) =>
      Effect.sync(() => {
        finishers.get(callKeyText(call.key))?.(result);
      }),
    loseHost: (call) =>
      Effect.sync(() => {
        executor.lose(call.key);
      }),
    settle: () => Effect.promise(() => settledOf(clock, delivered.take)),
  };
}

describe('the memory timers meet the contract every timer store meets', () => {
  it.each(timerProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run(timerSubject()))).toEqual(probe.expected);
  });
});

describe('the memory executor meets the contract every executor meets', () => {
  it.each(executorProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run(executorSubject()))).toEqual(probe.expected);
  });
});
