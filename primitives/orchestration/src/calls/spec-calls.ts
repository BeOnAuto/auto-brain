import { invalidArguments, type CallResult } from '@beonauto/operations';
import { jsonBytesOf } from '@beonauto/workflow-engine';
import type { Perform } from '@beonauto/workflow-host';
import { Effect, Option } from 'effect';

import { isArgumentsProblem, specArgumentsOf } from '../document/spec-arguments.ts';
import { attributesOfRun } from '../runs/run-attributes.ts';
import { nestedExecutionId } from './nested-execution-id.ts';
import type { ExecuteSpec, SpecExecutionResult } from './spec-execution.ts';

const mostSpecOutputBytes = 1_048_576;

const noCaller: CallResult = {
  status: 'failed',
  detail: 'The run names no brain and no caller to execute a spec for',
};

function rejectionDetail(
  detail: string,
  issues: readonly { readonly pointer: string; readonly detail: string }[],
): string {
  return issues.length === 0
    ? detail
    : `${detail} (${issues.map((issue) => `${issue.pointer}: ${issue.detail}`).join('; ')})`;
}

function callResultOf(result: SpecExecutionResult): CallResult {
  if (result.status === 'rejected') {
    const { reason, detail, issues = [], kind, because } = result;
    return {
      status: 'rejected',
      reason,
      detail: rejectionDetail(detail, issues),
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
    };
  }
  if (result.status === 'failed') {
    return result;
  }
  const bytes = jsonBytesOf(result.output);
  return bytes > mostSpecOutputBytes
    ? {
        status: 'failed',
        detail: `The spec answered with ${bytes} bytes as JSON, more than the ${mostSpecOutputBytes} a workflow takes`,
      }
    : result;
}

export function specCalls(executeSpec: ExecuteSpec): Perform {
  return (call, run) =>
    Option.match(attributesOfRun(run.attributes), {
      onNone: () => Effect.succeed(noCaller),
      onSome: ({ org, brain, execution_id: workflowExecution, caller }) => {
        const spec = specArgumentsOf(call.arguments);
        if (isArgumentsProblem(spec)) {
          return Effect.succeed<CallResult>({ status: 'rejected', reason: invalidArguments, detail: spec.title });
        }
        const executionId = nestedExecutionId(workflowExecution, call.key.reference, call.key.run);
        return executeSpec({ org, brain, caller, ...spec, executionId }).pipe(Effect.map(callResultOf));
      },
    });
}
