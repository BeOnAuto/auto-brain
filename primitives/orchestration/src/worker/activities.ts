import type { SettleExecution, Settlement } from '@beonauto/specs';
import { ApplicationFailure } from '@temporalio/activity';
import { Effect, Result } from 'effect';

import { jsonBytesOf } from '../dsl/json.ts';
import type { RunSettlement, SettleRequest, SpecCall, SpecCallResult } from '../interpreter/host.ts';
import {
  executionConflict,
  executionNotFound,
  tenancyViolation,
  workflowIdOf,
  type OrchestrationActivities,
} from '../workflow/activity-contract.ts';
import type { ExecuteSpec, SpecExecutionResult } from './dependencies.ts';
import { nestedExecutionId } from './nested-execution-id.ts';

export interface ActivityRun {
  readonly workflowId: string;
  readonly runId: string;
}

export interface ActivityDependencies {
  readonly executeSpec: ExecuteSpec;
  readonly settle: SettleExecution;
  readonly currentRun: () => ActivityRun;
}

const mostSpecOutputBytes = 1_048_576;

export function workflowRunOf({ workflowExecution }: { readonly workflowExecution?: ActivityRun }): ActivityRun {
  if (workflowExecution === undefined) {
    throw ApplicationFailure.nonRetryable('An orchestration activity runs only for a workflow', tenancyViolation);
  }
  return workflowExecution;
}

export function makeActivities(dependencies: ActivityDependencies): OrchestrationActivities {
  return {
    executeSpec: (call) => executeSpecFor(dependencies, call),
    settleExecution: (request) => settleFor(dependencies, request),
  };
}

async function executeSpecFor(dependencies: ActivityDependencies, call: SpecCall): Promise<SpecCallResult> {
  const { workflowId, runId } = dependencies.currentRun();
  const { org, brain, caller, primitive, name, input, reference, run } = call;
  if (!workflowId.startsWith(`${org}/${brain}/`) || caller.org !== org) {
    throw rejectedTenancy(workflowId, org, brain);
  }
  const executionId = nestedExecutionId(runId, reference, run);
  const result = await Effect.runPromise(
    dependencies.executeSpec({ org, brain, caller, primitive, name, input, executionId }),
  );
  return callResultOf(result);
}

function callResultOf(result: SpecExecutionResult): SpecCallResult {
  if (result.status !== 'succeeded') {
    return result.status === 'rejected'
      ? { status: 'rejected', reason: result.reason, detail: rejectionDetail(result.detail, result.issues ?? []) }
      : result;
  }
  const bytes = jsonBytesOf(result.output);
  return bytes > mostSpecOutputBytes
    ? {
        status: 'failed',
        detail: `The spec answered with ${bytes} bytes as JSON, more than the ${mostSpecOutputBytes} a workflow takes`,
      }
    : result;
}

function rejectionDetail(
  detail: string,
  issues: readonly { readonly pointer: string; readonly detail: string }[],
): string {
  return issues.length === 0
    ? detail
    : `${detail} (${issues.map((issue) => `${issue.pointer}: ${issue.detail}`).join('; ')})`;
}

async function settleFor(dependencies: ActivityDependencies, request: SettleRequest): Promise<void> {
  const { workflowId } = dependencies.currentRun();
  const { org, brain, spec, executionId, settlement } = request;
  if (workflowId !== workflowIdOf(org, brain, spec, executionId)) {
    throw rejectedTenancy(workflowId, org, brain);
  }
  const settled = await Effect.runPromise(
    Effect.result(dependencies.settle({ org, brain, id: executionId }, settlementOf(settlement))),
  );
  if (Result.isFailure(settled)) {
    const { _tag: reason, detail } = settled.failure;
    throw reason === 'not_found'
      ? ApplicationFailure.nonRetryable(detail, executionNotFound)
      : ApplicationFailure.retryable(detail, executionConflict);
  }
}

function settlementOf(settlement: RunSettlement): Settlement {
  return settlement.status === 'succeeded'
    ? { status: 'succeeded', output: settlement.output, record: {} }
    : settlement;
}

function rejectedTenancy(workflowId: string, org: string, brain: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(
    `The run ${workflowId} may not act for the brain ${brain} of the org ${org}`,
    tenancyViolation,
  );
}
