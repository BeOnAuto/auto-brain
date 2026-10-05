import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { mostEventBytes, mostHeldBytes, mostHistoryBytes, mostInputs } from '../machine/limits.ts';
import { newRun, type RunOutcome, type RunState } from '../machine/run-state.ts';
import { eventBytesOf } from '../run-log/run-event.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import { testMachine } from '../testing/driver-inputs.ts';
import { armedTimerIds, drivenExecutionId, drivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowMachine } from './workflow-machine.ts';

const megabyte = 1_048_576;

function titleOf(outcome: RunOutcome | null): string {
  return outcome?.kind === 'raised' ? (outcome.error.title ?? '') : JSON.stringify(outcome);
}

function waitingState(): RunState {
  const waiting: { state?: RunState } = {};
  drivenRun(workflow('do:\n  - pause: { wait: PT1H }'), {
    meanwhile: (driver, executionId) => {
      waiting.state = driver.state(executionId);
    },
  });
  return waiting.state ?? newRun;
}

function afterTheWait(state: RunState): RunState {
  const [timerId = ''] = armedTimerIds(state, 'wait');
  const input = {
    kind: 'timer_fired',
    executionId: drivenExecutionId,
    at: state.lastInputAt + 3_600_000,
    timerId,
  } as const;
  const events = Result.getOrThrow(workflowMachine(testMachine).decide(input, state));
  return events.reduce((folded, event) => evolveRun(folded, event), state);
}

describe('a run ends, raised, in one small event, when an input would make an event larger than one event holds', () => {
  it('at its start, and keeps no part of it', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'), {
      input: { text: 'x'.repeat(mostEventBytes) },
    });

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(`^An input changed the run by \\d+ bytes, more than the ${mostEventBytes} one event holds$`, 'u'),
    );
    expect(run.ended.workflow?.document).toEqual({});
    expect(run.events.map(({ event }) => eventBytesOf(event) < 4096)).toEqual([true]);
  });

  it('with an answer', () => {
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }\n  - pause: { wait: PT1H }'), {
      respond: () => ({ result: { status: 'succeeded', output: 'x'.repeat(2 * megabyte) } }),
    });

    expect(titleOf(run.outcome)).toContain('one event holds');
    expect(run.events.every(({ event }) => eventBytesOf(event) <= mostEventBytes)).toBe(true);
  });
});

describe('a run ends, raised, in one small event', () => {
  it('when the data it holds would pass the most a workflow may hold', () => {
    const document = workflow(`
do:
  - all:
      fork:
        branches:
          - a: { call: notify, with: { to: a } }
          - b: { call: notify, with: { to: b } }
          - c: { call: notify, with: { to: c } }
          - d: { call: notify, with: { to: d } }
          - e: { wait: PT1H }
`);
    const output = 'x'.repeat(1.2 * megabyte);
    const run = drivenRun(document, {
      respond: (call) => ({ after: call.key.reference.length, result: { status: 'succeeded', output } }),
    });

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(
        `^The workflow would hold about \\d+ bytes of data at once, more than the ${mostHeldBytes} a workflow may hold$`,
        'u',
      ),
    );
  });

  it('when the input would take its history past the most a run keeps', () => {
    const ended = afterTheWait({ ...waitingState(), historyBytes: mostHistoryBytes - 100 });

    expect(titleOf(ended.outcome)).toMatch(
      /^The run's history would take \d+ bytes, more than the 536870912 a run keeps$/u,
    );
    expect(ended.timers.armed).toEqual({});
  });

  it(`when it has taken ${mostInputs} inputs`, () => {
    const ended = afterTheWait({ ...waitingState(), inputs: mostInputs });

    expect(titleOf(ended.outcome)).toBe(`The run took ${mostInputs} inputs, the most a run takes`);
    expect(ended.inputs).toBe(mostInputs + 1);
  });
});
