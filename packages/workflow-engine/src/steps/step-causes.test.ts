import type { CallResult } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import type { StartCall } from '../dispatch/run-output.ts';
import { taskNameOf } from '../dsl/tasks.ts';
import type { RunEvent } from '../run-log/run-event.ts';
import { drivenRun, type DriveOptions, type DrivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { isRecordedStep, type Step, type StepCause } from './step-entry.ts';

function causeShown(cause: StepCause): string {
  return cause === 'input' ? 'input' : `${taskNameOf(cause.reference)}#${cause.run} ${cause.outcome} ${cause.times}`;
}

function stepShown(step: Step): string {
  return `${step.name}#${step.run} ${step.outcome} ${step.times} <- ${causeShown(step.caused_by)}`;
}

function shown({ steps }: RunEvent): readonly string[] {
  return steps.filter((step) => isRecordedStep(step)).map((step) => stepShown(step));
}

function recordedIn({ steps }: RunEvent): readonly Step[] {
  return steps.filter((step) => isRecordedStep(step));
}

function childrenOf(run: DrivenRun): readonly (string | undefined)[] {
  return run.events.flatMap(({ event }) =>
    recordedIn(event)
      .filter(({ outcome }) => outcome === 'waiting')
      .map(({ child }) => child),
  );
}

function waitsOf(run: DrivenRun): readonly (string | undefined)[] {
  return run.events.flatMap(({ event }) =>
    recordedIn(event)
      .filter(({ outcome }) => outcome === 'waiting')
      .map((step) => step.waits_for),
  );
}

function stepsOf(source: string, options: DriveOptions = {}): readonly (readonly string[])[] {
  return drivenRun(workflow(source), options).events.map(({ event }) => shown(event));
}

const succeeded: CallResult = { status: 'succeeded', output: 'done' };

const unavailable: CallResult = { status: 'rejected', reason: 'unavailable', detail: 'Busy' };

function failingFirst({ key }: StartCall) {
  return { after: 10, result: key.run === 1 ? unavailable : succeeded };
}

describe('the cause of each step', () => {
  it('is the step before it in a sequence, and its own start for its outcome', () => {
    expect(stepsOf('do:\n  - a: { set: { a: 1 } }\n  - b: { set: { b: 2 } }')).toEqual([
      ['a#1 started 1 <- input', 'a#1 completed 1 <- a#1 started 1', 'b#1 started 1 <- a#1 completed 1'].concat(
        'b#1 completed 1 <- b#1 started 1',
      ),
    ]);
  });
});

describe('the cause of a step that a switch or a fork moved', () => {
  it('is the switch for the branch it takes, after a then jump, and the step that skipped for the next', () => {
    const steps = stepsOf(
      `
do:
  - pick:
      switch:
        - high: { when: '\${ .n > 1 }', then: big }
        - low: { then: small }
  - small: { set: { size: small }, then: end }
  - big: { if: '\${ .n > 9 }', set: { size: big } }
  - last: { set: { last: true } }
`,
      { input: { n: 5 } },
    );

    expect(steps).toEqual([
      [
        'pick#1 started 1 <- input',
        'pick#1 completed 1 <- pick#1 started 1',
        'big#1 started 1 <- pick#1 completed 1',
        'big#1 skipped 1 <- big#1 started 1',
        'last#1 started 1 <- big#1 skipped 1',
        'last#1 completed 1 <- last#1 started 1',
      ],
    ]);
  });

  it('is the fork for each of its branches, and the branch that ended last for the fork', () => {
    const steps = stepsOf(`
do:
  - both:
      fork:
        branches:
          - x: { set: { x: 1 } }
          - y: { wait: PT1S }
`);

    expect(steps).toEqual([
      [
        'both#1 started 1 <- input',
        'x#1 started 1 <- both#1 started 1',
        'x#1 completed 1 <- x#1 started 1',
        'y#1 started 1 <- both#1 started 1',
        'y#1 waiting 1 <- y#1 started 1',
      ],
      ['y#1 completed 1 <- input', 'both#1 completed 1 <- y#1 completed 1'],
    ]);
  });
});

describe('the cause of a step across inputs', () => {
  it('is the failed attempt for the attempt that retries it after its back-off, and the input for an answer', () => {
    const steps = stepsOf(
      `
do:
  - guarded:
      try:
        - ask: { call: notify, with: { to: ada } }
      catch:
        retry: { delay: PT1S, limit: { attempt: { count: 2 } } }
`,
      { respond: failingFirst },
    );

    expect(steps).toEqual([
      ['guarded#1 started 1 <- input', 'ask#1 started 1 <- guarded#1 started 1', 'ask#1 waiting 1 <- ask#1 started 1'],
      ['ask#1 raised 1 <- input'],
      ['ask#2 started 1 <- ask#1 raised 1', 'ask#2 waiting 1 <- ask#2 started 1'],
      ['ask#2 completed 1 <- input', 'guarded#1 completed 1 <- ask#2 completed 1'],
    ]);
  });

  it('counts each wait of a listen for all of several events, and is the input for each', () => {
    const steps = stepsOf(
      'do:\n  - both: { listen: { to: { all: [{ with: { type: a } }, { with: { type: b } }] } } }',
      {
        meanwhile: (driver, executionId) => {
          driver.at(10, () => {
            driver.deliver(executionId, { id: 'a', type: 'a' });
          });
          driver.at(20, () => {
            driver.deliver(executionId, { id: 'b', type: 'b' });
          });
        },
      },
    );

    expect(steps).toEqual([
      ['both#1 started 1 <- input', 'both#1 waiting 1 <- both#1 started 1'],
      ['both#1 waiting 2 <- input'],
      ['both#1 completed 1 <- input'],
    ]);
  });
});

describe('the cause of a step after a yield, a timeout or a cancel', () => {
  it('is the step before a yield for the step after it, in the input the yield lets go on', () => {
    const run = drivenRun(
      workflow("do:\n  - each: { for: { in: '${ [range(0; 120)] }' }, do: [{ one: { set: {} } }] }"),
    );
    const [first, second] = run.events.map(({ event }) => event.steps.filter((step) => isRecordedStep(step)));

    expect(second?.[0]?.caused_by).toEqual({
      reference: first?.at(-1)?.reference,
      run: first?.at(-1)?.run,
      outcome: 'completed',
      times: 1,
    });
  });

  it('is the input for a step that timed out, with its error, and a cancel records no step', () => {
    const run = drivenRun(workflow('do:\n  - slow: { timeout: { after: PT1S }, wait: PT1H }'));
    const cancelled = drivenRun(workflow('do:\n  - slow: { wait: PT1H }'), {
      meanwhile: (driver, executionId) => {
        driver.cancel(executionId);
      },
    });

    expect(run.events.map(({ event }) => event.steps.at(-1))).toEqual([
      expect.objectContaining({ outcome: 'waiting' }),
      expect.objectContaining({
        outcome: 'timed_out',
        caused_by: 'input',
        error: {
          type: 'https://open-workflow-specification.org/spec/1.0.0/errors/timeout',
          title: 'The task did not finish within 1000 ms',
        },
      }),
    ]);
    expect(cancelled.events.at(-1)?.event.steps).toEqual([]);
  });
});

describe('the child of a call', () => {
  it('names the run the function gives for its arguments on the call, and none for arguments it refuses', () => {
    const run = drivenRun(
      workflow('do:\n  - ask: { call: notify, with: { to: ada } }\n  - text: { call: notify, with: plain }'),
      { respond: () => ({ result: succeeded }) },
    );
    expect(childrenOf(run)).toEqual(['notify at /do/0/ask #1', undefined]);
    expect(waitsOf(run)).toEqual(['call', 'call']);
  });

  it('is not named when its arguments are too large to call it, which raises after it starts', () => {
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: \'${ "x" * 300000 }\' } }'));

    expect(run.events[0]?.event.steps.map(({ outcome }) => outcome)).toEqual(['started', 'raised']);
  });
});
