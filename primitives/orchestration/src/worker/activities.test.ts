import { Conflict, NotFound } from '@beonauto/operations';
import type { SettleExecution, Settlement } from '@beonauto/specs';
import { ApplicationFailure } from '@temporalio/activity';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { settledExecution } from '../testing/temporal.ts';
import { acmeCaller } from '../testing/workflows.ts';
import { makeActivities, workflowRunOf, type ActivityRun } from './activities.ts';
import type { SpecExecution, SpecExecutionResult } from './dependencies.ts';
import { nestedExecutionId } from './nested-execution-id.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run: ActivityRun = { workflowId: `acme/alpha/flow/${executionId}`, runId: 'run-1', attempt: 1 };

function ignore(): void {
  return undefined;
}

const call = {
  org: 'acme',
  brain: 'alpha',
  caller: acmeCaller,
  reference: '/do/0/ask',
  run: 3,
  primitive: 'inference',
  name: 'ask',
  input: { q: 1 },
};

function activitiesAnswering(
  result: SpecExecutionResult,
  record: (execution: SpecExecution) => unknown = (execution) => execution,
) {
  return makeActivities({
    executeSpec: (execution) =>
      Effect.sync(() => {
        record(execution);
        return result;
      }),
    settle: () => Effect.die('not settling'),
    reportUnsettled: ignore,
    currentRun: () => run,
  });
}

describe('the activity that executes a spec', () => {
  it('executes it for the caller under an id derived from the run, the task and the run of the task', async () => {
    const executions: SpecExecution[] = [];

    const record = (execution: SpecExecution): void => {
      executions.push(execution);
    };

    expect(await activitiesAnswering({ status: 'succeeded', output: 'yes' }, record).executeSpec(call)).toEqual({
      status: 'succeeded',
      output: 'yes',
    });
    expect(executions).toEqual([
      {
        org: 'acme',
        brain: 'alpha',
        caller: acmeCaller,
        primitive: 'inference',
        name: 'ask',
        input: { q: 1 },
        executionId: nestedExecutionId('run-1', '/do/0/ask', 3),
      },
    ]);
  });

  it('rejects a call for a brain or an org its workflow does not belong to', async () => {
    const activities = activitiesAnswering({ status: 'succeeded', output: null });
    const violation = ApplicationFailure.nonRetryable(
      `The run acme/alpha/flow/${executionId} may not act for the brain beta of the org acme`,
      'TenancyViolation',
    );

    await expect(activities.executeSpec({ ...call, brain: 'beta' })).rejects.toEqual(violation);
    await expect(activities.executeSpec({ ...call, caller: { ...acmeCaller, org: 'globex' } })).rejects.toThrow(
      'may not act for',
    );
  });
});

describe('the results of executing a spec', () => {
  it('carry a rejection with its issues folded into its detail', async () => {
    const rejected = activitiesAnswering({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input is wrong',
      issues: [{ pointer: '/input/q', detail: 'Expected a string' }],
    });
    const plain = activitiesAnswering({ status: 'rejected', reason: 'not_found', detail: 'There is no spec ask' });

    expect(await rejected.executeSpec(call)).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input is wrong (/input/q: Expected a string)',
    });
    expect(await plain.executeSpec(call)).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no spec ask',
    });
  });

  it('carry a failure, and fail an output larger than a workflow takes', async () => {
    const failed = activitiesAnswering({ status: 'failed', detail: 'incident 9' });
    const large = activitiesAnswering({ status: 'succeeded', output: 'x'.repeat(1_048_600) });

    expect(await failed.executeSpec(call)).toEqual({ status: 'failed', detail: 'incident 9' });
    expect(await large.executeSpec(call)).toEqual({
      status: 'failed',
      detail: 'The spec answered with 1048602 bytes as JSON, more than the 1048576 a workflow takes',
    });
  });
});

function activitiesSettling(settle: SettleExecution) {
  return makeActivities({
    executeSpec: () => Effect.die('not executing'),
    settle,
    reportUnsettled: ignore,
    currentRun: () => run,
  });
}

const request = { org: 'acme', brain: 'alpha', spec: 'flow', executionId, settlement: { status: 'failed' } } as const;

describe('the activity that settles an execution', () => {
  it('settles the execution of its own workflow, a success with an empty record', async () => {
    const settled: Settlement[] = [];
    const activities = activitiesSettling((address, settlement) =>
      Effect.sync(() => {
        settled.push(settlement);
        return settledExecution(address, settlement);
      }),
    );

    await activities.settleExecution({ ...request, settlement: { status: 'succeeded', output: 1 } });
    await activities.settleExecution(request);

    expect(settled).toEqual([{ status: 'succeeded', output: 1, record: {} }, { status: 'failed' }]);
  });

  it('rejects settling an execution of another workflow', async () => {
    const activities = activitiesSettling(() => Effect.die('not settling'));

    await expect(activities.settleExecution({ ...request, spec: 'other' })).rejects.toThrow('may not act for');
  });
});

describe('an execution that cannot be settled', () => {
  it('fails for good when it is not there, and is retried after a conflict', async () => {
    const missing = activitiesSettling(() => Effect.fail(new NotFound({ detail: 'There is no such execution' })));
    const conflicting = activitiesSettling(() => Effect.fail(new Conflict({ detail: 'It runs within its call' })));

    await expect(missing.settleExecution(request)).rejects.toEqual(
      ApplicationFailure.nonRetryable('There is no such execution', 'ExecutionNotFound'),
    );
    await expect(conflicting.settleExecution(request)).rejects.toMatchObject({
      message: 'It runs within its call',
      type: 'ExecutionConflict',
      nonRetryable: false,
    });
  });

  it('is a benign failure after a conflict, which Temporal does not log as a warning, since the call that started the execution has yet to record it deferred', async () => {
    const conflicting = activitiesSettling(() => Effect.fail(new Conflict({ detail: 'It runs within its call' })));

    await expect(conflicting.settleExecution(request)).rejects.toMatchObject({ category: 'BENIGN' });
  });
});

describe('the workflow run an activity acts for', () => {
  it('is the run of the workflow that scheduled it, with the attempt, and there must be one', () => {
    expect(workflowRunOf({ workflowExecution: { workflowId: 'w', runId: 'r' }, attempt: 2 })).toStrictEqual({
      workflowId: 'w',
      runId: 'r',
      attempt: 2,
    });
    expect(() => workflowRunOf({ attempt: 1 })).toThrow('An orchestration activity runs only for a workflow');
  });
});
