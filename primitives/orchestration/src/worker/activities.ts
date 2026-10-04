import { Conflict, NotFound } from '@beonauto/operations';
import type { SettleExecution, Settlement } from '@beonauto/specs';
import { jsonBytesOf } from '@beonauto/workflow-engine/dsl/json';
import { ApplicationFailure } from '@temporalio/activity';
import { ApplicationFailureCategory } from '@temporalio/common';
import { Cause, Effect, Exit } from 'effect';

import type { RunSettlement, SettleRequest, SpecCall, SpecCallResult } from '../interpreter/host.ts';
import {
  executionConflict,
  executionNotFound,
  mostSettleAttempts,
  tenancyViolation,
  workflowIdOf,
  type OrchestrationActivities,
} from '../workflow/activity-contract.ts';
import type { ExecuteSpec, ReportUnsettled, SpecExecutionResult } from './dependencies.ts';
import { nestedExecutionId } from './nested-execution-id.ts';

export interface ActivityRun {
  readonly workflowId: string;
  readonly runId: string;
  readonly attempt: number;
}

interface Heartbeat {
  readonly beat: () => void;
  readonly everyMs: number;
}

export interface ActivityDependencies {
  readonly executeSpec: ExecuteSpec;
  readonly settle: SettleExecution;
  readonly reportUnsettled: ReportUnsettled;
  readonly currentRun: () => ActivityRun;
  readonly heartbeat: Heartbeat;
}

interface ActivityInfo {
  readonly workflowExecution?: { readonly workflowId: string; readonly runId: string };
  readonly attempt: number;
}

const mostSpecOutputBytes = 1_048_576;

const settlementBroken = 'SettlementBroken';

export function workflowRunOf({ workflowExecution, attempt }: ActivityInfo): ActivityRun {
  if (workflowExecution === undefined) {
    throw ApplicationFailure.nonRetryable('An orchestration activity runs only for a workflow', tenancyViolation);
  }
  return { workflowId: workflowExecution.workflowId, runId: workflowExecution.runId, attempt };
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
  const beating = setInterval(dependencies.heartbeat.beat, dependencies.heartbeat.everyMs);
  try {
    const result = await Effect.runPromise(
      dependencies.executeSpec({ org, brain, caller, primitive, name, input, executionId }),
    );
    return callResultOf(result);
  } finally {
    clearInterval(beating);
  }
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
  const { workflowId, attempt } = dependencies.currentRun();
  const { org, brain, spec, executionId, settlement } = request;
  const unsettled = (reason: string): void => {
    dependencies.reportUnsettled({ org, brain, executionId, reason });
  };
  if (workflowId !== workflowIdOf(org, brain, spec, executionId)) {
    const violation = rejectedTenancy(workflowId, org, brain);
    unsettled(violation.message);
    throw violation;
  }
  const settled = await Effect.runPromise(
    Effect.exit(dependencies.settle({ org, brain, id: executionId }, settlementOf(settlement))),
  );
  if (Exit.isSuccess(settled)) {
    return;
  }
  const failure = Cause.squash(settled.cause);
  if (failure instanceof NotFound) {
    unsettled(`The ledger has no such execution: ${failure.detail}`);
    throw ApplicationFailure.nonRetryable(failure.detail, executionNotFound);
  }
  const detail = failure instanceof Conflict ? failure.detail : `Settling broke down: ${String(failure)}`;
  if (attempt >= mostSettleAttempts) {
    unsettled(`Settling failed on all ${mostSettleAttempts} attempts: ${detail}`);
  }
  throw failure instanceof Conflict
    ? ApplicationFailure.create({
        message: detail,
        type: executionConflict,
        category: ApplicationFailureCategory.BENIGN,
      })
    : ApplicationFailure.retryable(detail, settlementBroken);
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
