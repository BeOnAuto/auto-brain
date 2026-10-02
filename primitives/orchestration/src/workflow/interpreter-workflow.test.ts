import { describe, expect, it } from 'vitest';

import { FakeCancellation } from '../testing/fake-cancellation.ts';
import { fakeWorkflowApi } from '../testing/fake-workflow-api.ts';
import { runOf, workflow } from '../testing/workflows.ts';
import { defineInterpreterWorkflow } from './interpreter-workflow.ts';

const signalCalls = new Set(['defineSignal', 'setHandler']);

describe('the interpreter workflow', () => {
  it('defines the event signal once, and handles it in each run', async () => {
    const fake = fakeWorkflowApi();
    const run = defineInterpreterWorkflow(fake.api);

    await run(runOf(workflow('do: []')));

    expect(fake.calls().filter(({ name }) => signalCalls.has(name))).toEqual([
      { name: 'defineSignal', signal: 'event' },
      { name: 'setHandler', signal: 'event' },
    ]);
    expect(fake.calls()[0]).toStrictEqual({ name: 'defineSignal', signal: 'event' });
  });

  it('returns the output of the workflow it ran, after settling the execution', async () => {
    const fake = fakeWorkflowApi();

    expect(await defineInterpreterWorkflow(fake.api)(runOf(workflow('do:\n  - a: { set: { done: true } }')))).toEqual({
      done: true,
    });
    expect(fake.calls().at(-1)).toMatchObject({
      name: 'settleExecution',
      request: { settlement: { status: 'succeeded' } },
    });
  });

  it('executes specs through the activities of the workflow', async () => {
    const document = workflow('do:\n  - ask: { call: execute_spec, with: { primitive: inference, name: ask } }');

    expect(await defineInterpreterWorkflow(fakeWorkflowApi().api)(runOf(document))).toEqual({ answered: true });
  });

  it('delivers the events it is signalled to the workflow', async () => {
    const fake = fakeWorkflowApi();
    const running = defineInterpreterWorkflow(fake.api)(
      runOf(workflow('do:\n  - await: { listen: { to: { one: { with: { type: go } } } } }')),
    );
    fake.signal({ id: 'g', type: 'go', data: 'went' });

    expect(await running).toEqual(['went']);
  });
});

describe('the interpreter workflow that does not complete', () => {
  it('fails for a fault of the runtime with an application failure, and logs only the type for the operator', async () => {
    const fake = fakeWorkflowApi();

    await expect(defineInterpreterWorkflow(fake.api)({ document: 'none' })).rejects.toThrow(
      'InvalidRun: The workflow was started without a run it can read',
    );
    expect(fake.calls().filter(({ name }) => name === 'log')).toStrictEqual([
      {
        name: 'log',
        message: 'The workflow failed for a fault of the runtime',
        attributes: { failureType: 'InvalidRun' },
      },
    ]);
  });

  it('fails for a reason of the tenant with an application failure, and logs nothing', async () => {
    const fake = fakeWorkflowApi();
    const document = workflow(
      'do:\n  - no: { raise: { error: { type: https://example.com/no, status: 422, title: No } } }',
    );

    await expect(defineInterpreterWorkflow(fake.api)(runOf(document))).rejects.toThrow(
      'UncaughtError: No (at /do/0/no)',
    );
    expect(fake.calls().filter(({ name }) => name === 'log')).toStrictEqual([]);
  });

  it('ends cancelled by rethrowing the cancellation', async () => {
    const cancellation = new FakeCancellation();
    const fake = fakeWorkflowApi({ sleep: () => Promise.reject(cancellation) });

    await expect(defineInterpreterWorkflow(fake.api)(runOf(workflow('do:\n  - pause: { wait: PT1S }')))).rejects.toBe(
      cancellation,
    );
  });
});
