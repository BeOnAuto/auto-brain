import { describe, expect, it } from 'vitest';

import { mostExpressionWork, mostWorkPerInput } from '../machine/limits.ts';
import type { RunOutcome } from '../machine/run-state.ts';
import { drivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { errorType } from './raised-error.ts';

const text = 'x'.repeat(1000);

const justOverTheBudget = 'x'.repeat(mostExpressionWork - 15);

function titleOf(outcome: RunOutcome | null): string {
  return outcome?.kind === 'raised' ? (outcome.error.title ?? '') : JSON.stringify(outcome);
}

describe('an expression of a task', () => {
  it('that fails raises an expression error with what went wrong', () => {
    const run = drivenRun(workflow('do:\n  - broken: { set: \'${ error("boom") }\' }'));

    expect(run.outcome).toEqual({
      kind: 'raised',
      error: {
        type: errorType('expression'),
        status: 400,
        title: 'An expression failed',
        detail: ' error("boom") : RuntimeError: boom',
        instance: '/do/0/broken',
      },
    });
  });

  it('that does more work than an expression may raises a runtime error', () => {
    const run = drivenRun(workflow("do:\n  - heavy: { set: '${ [limit(9000; repeat(.text))] | length }' }"), {
      input: { text },
    });

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(`: an expression may do ${mostExpressionWork} units of work$`, 'u'),
    );
  });

  it('that does more work than is left of the input raises a runtime error that says so', () => {
    const heavy = "'${ [limit(2500; repeat(.text))] | length }'";
    const run = drivenRun(workflow(`do:\n  - heavy: { set: { a: ${heavy}, b: ${heavy}, c: ${heavy} } }`), {
      input: { text },
    });

    expect(titleOf(run.outcome)).toMatch(
      new RegExp(`: the workflow did ${mostWorkPerInput} units of expression work in one input; `, 'u'),
    );
  });
});

describe('a value an expression of a task builds', () => {
  it('nested deeper than 512 levels raises an expression error with the depth of a value', () => {
    const run = drivenRun(
      workflow("do:\n  - deep: { set: '${ reduce range(2000) as $i (null; [.]) | tojson | length }' }"),
    );

    expect(run.outcome).toEqual({
      kind: 'raised',
      error: {
        type: errorType('expression'),
        status: 400,
        title: 'An expression failed',
        detail: ' reduce range(2000) as $i (null; [.]) | tojson | length : LimitError: Value depth limit exceeded',
        instance: '/do/0/deep',
      },
    });
  });
});

describe('a value a task gives', () => {
  it('that takes more work to visit than a workflow may hold raises a runtime error', () => {
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'), {
      respond: () => ({ result: { status: 'succeeded', output: justOverTheBudget } }),
    });

    expect(titleOf(run.outcome)).toBe(
      `A value takes ${mostExpressionWork + 1} units of work to visit, more than the ${mostExpressionWork} a workflow may hold`,
    );
  });
});

describe('a duration of a task', () => {
  it('that is not a duration raises a configuration error', () => {
    expect(titleOf(drivenRun(workflow('do:\n  - pause: { wait: soon }')).outcome)).toMatch(
      /^A duration of the task is not valid: /u,
    );
  });

  it('that is longer than the workflow may run raises a configuration error', () => {
    const run = drivenRun(workflow('do:\n  - pause: { wait: P31D }'));

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'A duration of the task, 2678400000 ms, is longer than the 2592000000 ms a workflow may run' },
    });
  });
});
