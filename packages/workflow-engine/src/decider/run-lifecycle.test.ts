import { describe, expect, it } from 'vitest';

import { mostValueDepth, type Json } from '../dsl/json.ts';
import { errorType } from '../dsl/raised-error.ts';
import { mostOutputBytes, mostStepsWithoutWaiting } from '../machine/limits.ts';
import { armedTimersAlong, drivenExecutionId, drivenRun, outputKindsIn, outputsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

function nested(depth: number): Json {
  return depth === 0 ? 1 : [nested(depth - 1)];
}

describe('a run', () => {
  it('reads its input through input.from and shapes its output through output.as', () => {
    const document = workflow(`
input: { from: '\${ { name: .who } }' }
output: { as: '\${ { greeting: .greeting, by: $workflow.input.who } }' }
do:
  - greet: { set: { greeting: '\${ "Hello, " + .name }' } }
`);

    expect(drivenRun(document, { input: { who: 'Ada' } }).outcome).toEqual({
      kind: 'completed',
      output: { greeting: 'Hello, Ada', by: 'Ada' },
    });
  });

  it('settles with the outcome it ends with, once, in its last event', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'));
    const settlement = { status: 'succeeded', output: { done: true } };

    expect(outputsIn(run.events)).toContainEqual({ kind: 'settle', executionId: drivenExecutionId, settlement });
    expect(outputKindsIn(run.events).filter((kind) => kind === 'settle')).toHaveLength(1);
    expect(outputKindsIn(run.events.slice(-1)).at(-1)).toBe('settle');
  });

  it('raises a timeout when the whole document takes longer than its timeout', () => {
    const run = drivenRun(workflow('timeout: { after: PT1M }\ndo:\n  - pause: { wait: PT1H }'));
    const title = 'The task did not finish within 60000 ms';

    expect(run.outcome).toEqual({
      kind: 'raised',
      error: { type: errorType('timeout'), status: 408, title, instance: '/' },
    });
  });

  it('is stopped when it has run the most it may, and settles as cancelled for overrunning', () => {
    const document = workflow('do:\n  - first: { wait: PT40M }\n  - second: { wait: PT40M }');
    const run = drivenRun(document, { limits: { mostDurationMs: 3_600_000 } });

    expect(run.outcome).toEqual({ kind: 'overran', milliseconds: 3_600_000 });
    expect(run.driver.ports.recordStore.settlementOf(drivenExecutionId)).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'overrun',
      detail: 'The workflow ran for 3600000 ms, the most a workflow may run, and was stopped',
    });
  });
});

describe('a run that is cancelled or refused', () => {
  it('is cancelled when asked, cancels what it waits for as its parent ended, and settles as cancelled by who asked', () => {
    const cancel = { by: 'acme-admin', kind: 'requested', reason: 'Not needed any more' } as const;
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'), {
      respond: () => 'never',
      meanwhile: (driver, executionId) => {
        driver.at(5, () => {
          driver.cancel(executionId, cancel);
        });
      },
    });

    expect(run.outcome).toEqual({ kind: 'cancelled', cancel });
    expect(run.ended.cancelRequested).toBe(true);
    expect(outputKindsIn(run.events.slice(-1))).toEqual(['cancel_call', 'cancel_timer', 'cancel_timer', 'settle']);
    expect(run.events.at(-1)?.event.outputs[0]).toMatchObject({ kind: 'cancel_call', reason: 'parent_ended' });
    expect(run.events.at(-1)?.event.receipt).toMatchObject({ cancel: { by: 'acme-admin', kind: 'requested' } });
    expect(run.driver.ports.recordStore.settlementOf(drivenExecutionId)).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
      detail: 'Not needed any more',
      by: 'acme-admin',
    });
  });

  it('refuses a document this runtime does not run before it runs any task', () => {
    const run = drivenRun(workflow('do:\n  - shout: { run: { shell: { command: ls } } }'));

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { status: 400, title: 'The workflow document is not allowed by this runtime', instance: '/' },
    });
  });

  it('raises when its input nests deeper than a value may', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'), {
      input: { deep: nested(mostValueDepth + 1) },
    });

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { title: `A value nests more than ${mostValueDepth} levels deep` },
    });
  });
});

describe('a run that does too much', () => {
  it('ends oversized when its output is larger than an execution records', () => {
    const run = drivenRun(workflow("do:\n  - big: { set: '${ { text: .text } }' }"), {
      input: { text: 'x'.repeat(mostOutputBytes) },
    });

    expect(run.outcome).toEqual({ kind: 'oversized', bytes: mostOutputBytes + 11, most: mostOutputBytes });
  });

  it(`raises once it ran ${mostStepsWithoutWaiting} tasks without waiting`, () => {
    const document = workflow("do:\n  - spin: { for: { in: '${ .items }' }, do: [{ step: { set: {} } }] }");
    const items = Array.from({ length: mostStepsWithoutWaiting }, (_item, index) => index);

    expect(drivenRun(document, { input: { items } }).outcome).toMatchObject({
      kind: 'raised',
      error: {
        title: `The workflow ran ${mostStepsWithoutWaiting} tasks without waiting for anything; it would never end`,
      },
    });
  }, 30_000);
});

describe('a task', () => {
  it('is skipped when its condition does not hold, and keeps its input', () => {
    const document = workflow("do:\n  - maybe: { if: '${ .go }', set: { went: true } }");

    expect(drivenRun(document, { input: { go: false } }).outcome).toEqual({ kind: 'completed', output: { go: false } });
    expect(drivenRun(document, { input: { go: true } }).outcome).toEqual({ kind: 'completed', output: { went: true } });
  });

  it('reads its input through input.from, shapes its output and exports to the context', () => {
    const document = workflow(`
do:
  - first:
      input: { from: '\${ .value }' }
      set: '\${ { doubled: (. * 2) } }'
      output: { as: '\${ .doubled }' }
      export: { as: '\${ { first: . } }' }
  - second: { set: '\${ { seen: $context.first, input: . } }' }
`);

    expect(drivenRun(document, { input: { value: 4 } }).outcome).toEqual({
      kind: 'completed',
      output: { seen: 8, input: 8 },
    });
  });

  it('raises a timeout when it takes longer than its own', () => {
    const run = drivenRun(workflow('do:\n  - pause: { wait: PT1H, timeout: { after: PT1S } }'));

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408, instance: '/do/0/pause' } });
  });

  it('uses a timeout the document names under use.timeouts, and raises one it does not name', () => {
    const named = workflow(
      'use:\n  timeouts:\n    short: { after: PT1S }\ndo:\n  - pause: { wait: PT1H, timeout: short }',
    );
    const missing = workflow('do:\n  - pause: { wait: PT1H, timeout: missing }');

    expect(drivenRun(named).outcome).toMatchObject({ kind: 'raised', error: { status: 408 } });
    expect(drivenRun(missing).outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'use.timeouts has no timeout missing' },
    });
  });
});

describe('a task that raises before it waits', () => {
  it('leaves no timeout armed, whether its body or the reading of its input raised', () => {
    const document = workflow(`
do:
  - first:
      try:
        - reject: { raise: { error: { type: x, status: 400 } }, timeout: { after: PT1M } }
      catch: {}
  - second:
      try:
        - misread: { set: { a: 1 }, input: { from: '\${ error("unreadable") }' }, timeout: { after: PT1M } }
      catch: {}
  - rest: { wait: PT1S }
`);
    const run = drivenRun(document);

    expect(run.outcome).toMatchObject({ kind: 'completed' });
    expect(armedTimersAlong(run.events)).toEqual([['deadline /', 'wait /do/2/rest'], []]);
  });
});
