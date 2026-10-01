import { WorkflowFailedError } from '@temporalio/client';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordHistory } from '../../replay-corpus.ts';
import { runFor, temporalHarness, type TemporalHarness } from '../testing/temporal.ts';
import { workflow } from '../testing/workflows.ts';

let harness: TemporalHarness;

beforeAll(async () => {
  harness = await temporalHarness('workflow-endings');
}, 60_000);

afterAll(async () => {
  await harness.close();
}, 60_000);

function idOf(number: number): string {
  return `0199a3c4-7d2e-7c1a-9b3f-${String(number).padStart(12, '1')}`;
}

function settledFor(executionId: string) {
  return harness.settled().filter(({ address }) => address.id === executionId);
}

describe('a workflow that fails', () => {
  it('settles its execution rejected and fails, recording no stack trace of the worker', async () => {
    const executionId = idOf(1);
    const run = runFor(
      workflow('do:\n  - refuse: { raise: { error: { type: https://example.com/no, status: 422, title: No } } }'),
      executionId,
    );
    const { workflowId } = await Effect.runPromise(harness.orchestration.start(run));

    const failure: unknown = await harness.temporal.workflow
      .getHandle(workflowId)
      .result()
      .catch((error: unknown) => error);
    const history = await harness.temporal.workflow.getHandle(workflowId).fetchHistory();
    await recordHistory('uncaught-error', () => harness.temporal.workflow.getHandle(workflowId).fetchHistory());

    expect(failure).toBeInstanceOf(WorkflowFailedError);
    expect(settledFor(executionId)).toEqual([
      {
        address: { org: 'acme', brain: 'alpha', id: executionId },
        settlement: { status: 'rejected', reason: 'invalid_input', detail: 'No (at /do/0/refuse)' },
      },
    ]);
    expect(history.events?.at(-1)?.workflowExecutionFailedEventAttributes?.failure).toMatchObject({
      message: 'No (at /do/0/refuse)',
      stackTrace: '',
      applicationFailureInfo: { type: 'UncaughtError', nonRetryable: true },
    });
  }, 60_000);
});

describe('a workflow that is cancelled', () => {
  it('settles its execution as failed and ends cancelled', async () => {
    const executionId = idOf(2);
    const { workflowId } = await Effect.runPromise(
      harness.orchestration.start(runFor(workflow('do:\n  - pause: { wait: PT1H }'), executionId)),
    );
    const handle = harness.temporal.workflow.getHandle(workflowId);

    await handle.cancel();
    const failure: unknown = await handle.result().catch((error: unknown) => error);
    await recordHistory('cancelled', () => handle.fetchHistory());

    expect(failure).toBeInstanceOf(WorkflowFailedError);
    expect((await handle.describe()).status.name).toBe('CANCELLED');
    expect(settledFor(executionId)).toEqual([
      { address: { org: 'acme', brain: 'alpha', id: executionId }, settlement: { status: 'failed' } },
    ]);
  }, 60_000);
});

describe('an execution started twice', () => {
  it('starts one workflow', async () => {
    const executionId = idOf(3);
    const document = workflow(`
do:
  - pause: { wait: { milliseconds: 500 } }
  - ask: { call: execute_spec, with: { primitive: inference, name: ask } }
`);
    const run = runFor(document, executionId, { once: true });

    const first = await Effect.runPromise(harness.orchestration.start(run));
    const second = await Effect.runPromise(harness.orchestration.start(run));
    await harness.temporal.workflow.getHandle(first.workflowId).result();

    expect(second).toEqual(first);
    expect(settledFor(executionId)).toHaveLength(1);
  }, 60_000);
});

describe('a run that names another brain than its workflow', () => {
  it('may not execute specs or settle executions for that brain', async () => {
    const executionId = idOf(4);
    const run = runFor(
      workflow('do:\n  - ask: { call: execute_spec, with: { primitive: inference, name: ask } }'),
      executionId,
    );
    const workflowId = `acme/beta/test-flow/${executionId}`;
    const handle = await harness.temporal.workflow.start('runWorkflowSpec', {
      taskQueue: harness.settings.taskQueue,
      workflowId,
      args: [run],
    });

    const failure: unknown = await handle.result().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(WorkflowFailedError);
    expect(harness.executions().filter(({ executionId: id }) => id === executionId)).toEqual([]);
    expect(settledFor(executionId)).toEqual([]);
  }, 60_000);
});
