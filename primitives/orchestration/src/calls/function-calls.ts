import { invalidArguments, type CallResult } from '@beonauto/operations';
import type { RunEnding } from '@beonauto/specs';
import { jsonBytesOf, stepEventIdOf } from '@beonauto/workflow-engine';
import type { CallAnswer, Perform } from '@beonauto/workflow-host';
import { Effect, Option } from 'effect';

import { isArgumentsProblem, specArgumentsOf } from '../document/spec-arguments.ts';
import { attributesOfRun } from '../runs/run-attributes.ts';
import { endedRunResultOf } from './function-results.ts';
import type { DefinitionRunResult, EndedRunResult, RunDefinition } from './function-run.ts';
import { nestedExecutionId } from './nested-execution-id.ts';

const mostSpecOutputBytes = 1_048_576;

const noCaller: CallAnswer = {
  status: 'failed',
  detail: 'The run names no brain and no caller to run a definition for',
};

function rejectionDetail(
  detail: string,
  issues: readonly { readonly pointer: string; readonly detail: string }[],
): string {
  return issues.length === 0
    ? detail
    : `${detail} (${issues.map((issue) => `${issue.pointer}: ${issue.detail}`).join('; ')})`;
}

function callResultOf(result: EndedRunResult): CallResult {
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
        detail: `The run returned ${bytes} bytes as JSON, more than the ${mostSpecOutputBytes} a workflow takes`,
      }
    : result;
}

export function callResultOfEnding(ending: RunEnding): CallResult {
  return callResultOf(endedRunResultOf(ending));
}

function callAnswerOf(result: DefinitionRunResult, child: string): CallAnswer {
  return result.status === 'waiting' ? { status: 'waiting', child } : callResultOf(result);
}

export function definitionCalls(executeSpec: RunDefinition): Perform {
  return (call, run) =>
    Option.match(attributesOfRun(run.attributes), {
      onNone: () => Effect.succeed(noCaller),
      onSome: ({ org, brain, execution_id: workflowExecution, caller, lineage, depth = 0, call_depth = 0 }) => {
        const spec = specArgumentsOf(call.arguments);
        if (isArgumentsProblem(spec)) {
          return Effect.succeed<CallAnswer>({ status: 'rejected', reason: invalidArguments, detail: spec.title });
        }
        const { reference, run: count } = call.key;
        const executionId = nestedExecutionId(workflowExecution, reference, count);
        const waiting = stepEventIdOf(workflowExecution, { reference, run: count, outcome: 'waiting', times: 1 });
        const correlationId = lineage?.correlation ?? workflowExecution;
        return executeSpec({
          org,
          brain,
          caller,
          ...spec,
          executionId,
          lineage: { causationId: waiting, correlationId },
          depth,
          callDepth: call_depth + 1,
          calledBy: { execution_id: workflowExecution, reference, run: count },
        }).pipe(Effect.map((result) => callAnswerOf(result, executionId)));
      },
    });
}
