import type { RunEnding } from '@beonauto/definitions';
import { invalidArguments, type CallResult } from '@beonauto/operations';
import { jsonBytesOf, stepEventIdOf } from '@beonauto/workflow-engine';
import type { CallAnswer, Perform } from '@beonauto/workflow-host';
import { Effect, Option } from 'effect';

import { isArgumentsProblem, definitionArgumentsOf } from '../document/definition-arguments.ts';
import { attributesOfRun } from '../runs/run-attributes.ts';
import { endedRunResultOf } from './function-results.ts';
import type { DefinitionRunResult, EndedRunResult, RunDefinition } from './function-run.ts';
import { nestedRunId } from './nested-run-id.ts';

const mostDefinitionOutputBytes = 1_048_576;

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
  return bytes > mostDefinitionOutputBytes
    ? {
        status: 'failed',
        detail: `The run returned ${bytes} bytes as JSON, more than the ${mostDefinitionOutputBytes} a workflow takes`,
      }
    : result;
}

export function callResultOfEnding(ending: RunEnding): CallResult {
  return callResultOf(endedRunResultOf(ending));
}

function callAnswerOf(result: DefinitionRunResult, child: string): CallAnswer {
  return result.status === 'waiting' ? { status: 'waiting', child } : callResultOf(result);
}

export function definitionCalls(runDefinition: RunDefinition): Perform {
  return (call, run) =>
    Option.match(attributesOfRun(run.attributes), {
      onNone: () => Effect.succeed(noCaller),
      onSome: ({ org, brain, run_id: workflowRun, caller, lineage, depth = 0, call_depth = 0 }) => {
        const definition = definitionArgumentsOf(call.arguments);
        if (isArgumentsProblem(definition)) {
          return Effect.succeed<CallAnswer>({ status: 'rejected', reason: invalidArguments, detail: definition.title });
        }
        const { reference, run: count } = call.key;
        const runId = nestedRunId(workflowRun, reference, count);
        const waiting = stepEventIdOf(workflowRun, { reference, run: count, outcome: 'waiting', times: 1 });
        const correlationId = lineage?.correlation ?? workflowRun;
        return runDefinition({
          org,
          brain,
          caller,
          ...definition,
          runId,
          lineage: { causationId: waiting, correlationId },
          depth,
          callDepth: call_depth + 1,
          calledBy: { run_id: workflowRun, reference, run: count },
        }).pipe(Effect.map((result) => callAnswerOf(result, runId)));
      },
    });
}
