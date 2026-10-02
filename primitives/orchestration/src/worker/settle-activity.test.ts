import { Conflict, NotFound } from '@beonauto/operations';
import type { SettleExecution, Settlement } from '@beonauto/specs';
import { ApplicationFailure } from '@temporalio/activity';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SettleRequest } from '../interpreter/host.ts';
import { settledExecution } from '../testing/temporal.ts';
import { makeActivities, type ActivityRun } from './activities.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run: ActivityRun = { workflowId: `acme/alpha/flow/${executionId}`, runId: 'run-1', attempt: 1 };

function ignore(): void {
  return undefined;
}

function activitiesSettling(settle: SettleExecution) {
  return makeActivities({
    executeSpec: () => Effect.die('not executing'),
    settle,
    reportUnsettled: ignore,
    currentRun: () => run,
    heartbeat: { beat: ignore, everyMs: 10_000 },
  });
}

const request: SettleRequest = {
  org: 'acme',
  brain: 'alpha',
  spec: 'flow',
  executionId,
  settlement: { status: 'failed' },
};

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
