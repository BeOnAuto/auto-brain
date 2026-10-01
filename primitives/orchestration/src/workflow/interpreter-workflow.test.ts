import { describe, expect, it } from 'vitest';

import { FakeCancellation } from '../testing/fake-cancellation.ts';
import { fakeWorkflowApi } from '../testing/fake-workflow-api.ts';
import { runOf, workflow } from '../testing/workflows.ts';
import { defineInterpreterWorkflow } from './interpreter-workflow.ts';

describe('the interpreter workflow', () => {
  it('defines the event signal once, and handles it in each run', async () => {
    const fake = fakeWorkflowApi();
    const run = defineInterpreterWorkflow(fake.api);

    await run(runOf(workflow('do: []')));

    expect(fake.calls().slice(0, 2)).toEqual([
      { name: 'defineSignal', signal: 'event' },
      { name: 'setHandler', signal: 'event' },
    ]);
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
  it('fails with an application failure that is not retried when the workflow fails', async () => {
    const fake = fakeWorkflowApi();

    await expect(defineInterpreterWorkflow(fake.api)({ document: 'none' })).rejects.toThrow(
      'InvalidRun: The workflow was started without a run it can read',
    );
  });

  it('ends cancelled by rethrowing the cancellation', async () => {
    const cancellation = new FakeCancellation();
    const fake = fakeWorkflowApi({ sleep: () => Promise.reject(cancellation) });

    await expect(defineInterpreterWorkflow(fake.api)(runOf(workflow('do:\n  - pause: { wait: PT1S }')))).rejects.toBe(
      cancellation,
    );
  });
});
