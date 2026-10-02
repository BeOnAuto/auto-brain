import { Conflict, NotFound } from '@beonauto/operations';
import type { SettleExecution } from '@beonauto/specs';
import { ApplicationFailure } from '@temporalio/activity';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SettleRequest } from '../interpreter/host.ts';
import { failureRecorder, type FailureRecorder } from '../testing/failure-recorder.ts';
import { settledExecution } from '../testing/temporal.ts';
import { makeActivities } from './activities.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const request: SettleRequest = {
  org: 'acme',
  brain: 'alpha',
  spec: 'flow',
  executionId,
  settlement: { status: 'failed' },
};

function ignore(): void {
  return undefined;
}

function settling(settle: SettleExecution, recorder: FailureRecorder, attempt = 1) {
  return makeActivities({
    executeSpec: () => Effect.die('not executing'),
    settle,
    reportUnsettled: recorder.reportUnsettled,
    currentRun: () => ({ workflowId: `acme/alpha/flow/${executionId}`, runId: 'run-1', attempt }),
    heartbeat: { beat: ignore, everyMs: 10_000 },
  });
}

function conflict() {
  return Effect.fail(new Conflict({ detail: 'It runs within its call' }));
}

const unsettled = { org: 'acme', brain: 'alpha', executionId };

describe('an execution that stays unsettled', () => {
  it('is reported when the ledger does not have it, or the run may not settle it', async () => {
    const recorder = failureRecorder();
    const missing = settling(() => Effect.fail(new NotFound({ detail: 'No such execution' })), recorder);
    await missing.settleExecution(request).catch((error: unknown) => error);
    await missing.settleExecution({ ...request, spec: 'other' }).catch((error: unknown) => error);

    expect(recorder.unsettled()).toStrictEqual([
      { ...unsettled, reason: 'The ledger has no such execution: No such execution' },
      {
        ...unsettled,
        reason: `The run acme/alpha/flow/${executionId} may not act for the brain alpha of the org acme`,
      },
    ]);
  });

  it('is reported when the last attempt fails, and only then', async () => {
    const recorder = failureRecorder();
    await settling(conflict, recorder, 19)
      .settleExecution(request)
      .catch((error: unknown) => error);
    await settling(conflict, recorder, 20)
      .settleExecution(request)
      .catch((error: unknown) => error);
    const broken = settling(() => Effect.die('the ledger broke'), recorder, 20);

    await expect(broken.settleExecution(request)).rejects.toEqual(
      ApplicationFailure.retryable('Settling broke down: the ledger broke', 'SettlementBroken'),
    );
    expect(recorder.unsettled()).toStrictEqual([
      { ...unsettled, reason: 'Settling failed on all 20 attempts: It runs within its call' },
      { ...unsettled, reason: 'Settling failed on all 20 attempts: Settling broke down: the ledger broke' },
    ]);
  });

  it('is not reported when it is settled', async () => {
    const recorder = failureRecorder();
    await settling(
      (address, settlement) => Effect.succeed(settledExecution(address, settlement)),
      recorder,
      20,
    ).settleExecution(request);

    expect(recorder.unsettled()).toStrictEqual([]);
  });
});
