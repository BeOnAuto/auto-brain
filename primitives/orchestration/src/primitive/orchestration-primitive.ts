import { InvalidInput } from '@beonauto/operations';
import { definePrimitive, type FinishesLater, type Primitive } from '@beonauto/specs';
import { Effect } from 'effect';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { measureOf, mostValueDepth, type JsonObject } from '../dsl/json.ts';
import type { OrchestrationClient } from './orchestration-client.ts';

export interface OrchestrationDependencies {
  readonly client: OrchestrationClient;
}

const orchestrationDescription = [
  'Runs a workflow: deterministic steps that execute other specs of the brain, branch, loop, run in parallel,',
  'wait, retry and catch errors, durably, until they end.',
  'A spec document of orchestration is a YAML workflow in the Open Workflow Specification DSL 1.0.x (the CNCF',
  'Serverless Workflow DSL): a mapping with document (dsl: 1.0.3, namespace, name, version, and an optional',
  'title and summary), an optional input (from, and an inline JSON Schema document), a do list of named tasks,',
  'an optional output (as, and a schema), an optional timeout, and optional use.errors, use.retries and',
  'use.timeouts to reuse.',
  'Tasks: set; call execute_spec with { primitive, name, input } to execute another spec of the brain and take',
  'its output (a rejection is an error the workflow can catch); do; switch; for; fork of at most 32 branches',
  '(compete: true races the branches); try with catch (errors.with, when, exceptWhen, retry with delay, backoff,',
  'jitter and limits, and do); wait; raise; and listen for events sent with send_execution_event.',
  'Task lists nest at most 64 levels deep. A workflow runs for at most the time the runtime is set to allow,',
  '30 days unless told otherwise; a wait or timeout longer than that is rejected, and one computed longer fails',
  'the workflow. An expression may do a bounded amount of work, about one pass over a few megabytes of data;',
  'more fails the workflow with a runtime error.',
  'Flow directives: then continue, exit, end, or the name of a task in the same list.',
  'Expressions are jq, enclosed in ${ }; if, when, for.in and while may also be written bare.',
  'Not allowed: run, emit, call of http, grpc, openapi, asyncapi, a2a or mcp, catalogs, extensions,',
  'reusable functions, secrets, authentications, schedules, task schemas, executing another workflow,',
  'and the jq builtins localtime and strflocaltime.',
  'An execution starts the workflow and answers started; get_execution shows it settled when the workflow ends:',
  'succeeded with its output, rejected when an error is not caught (invalid_input for a 4xx status other than',
  '408 and 429, unavailable otherwise), or failed.',
].join(' ');

export function makeOrchestration({ client }: OrchestrationDependencies): Primitive {
  return definePrimitive({
    name: 'orchestration',
    title: 'Orchestration',
    description: orchestrationDescription,
    mediaType: 'application/yaml',
    parse: (source: string): Effect.Effect<JsonObject, InvalidInput> =>
      parseWorkflowDocument(source, client.mostDuration),
    summarize: summaryOf,
    execute: (document, input, { id, org, brain, caller, spec }) =>
      admittedInput(input).pipe(
        Effect.andThen(
          client.start({
            document,
            input,
            execution: { id, org, brain, spec: { name: spec.name, version: spec.version } },
            caller,
          }),
        ),
        Effect.map(({ workflowId, runId }): FinishesLater => ({
          finishesLater: true,
          record: { workflow_id: workflowId, run_id: runId },
        })),
      ),
    whenCancelled: 'finish',
  });
}

function admittedInput(input: unknown): Effect.Effect<void, InvalidInput> {
  const problem = `The input nests more than ${mostValueDepth} levels deep`;
  return measureOf(input) === undefined
    ? Effect.fail(new InvalidInput({ detail: problem, issues: [{ detail: problem, pointer: '' }] }))
    : Effect.void;
}
