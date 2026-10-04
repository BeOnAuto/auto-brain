import { asSentence, InvalidInput } from '@beonauto/operations';
import { definePrimitive, inWords, type FinishesLater, type Primitive } from '@beonauto/specs';
import { measureOf, mostValueDepth, type JsonObject } from '@beonauto/workflow-engine/dsl/json';
import { Effect, type Schema } from 'effect';

import { parseWorkflowDocument } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import type { OrchestrationClient } from './orchestration-client.ts';
import { orchestrationDescription } from './orchestration-description.ts';

export interface OrchestrationDependencies {
  readonly client: OrchestrationClient;
}

function describeResult(output: Schema.Json): string {
  const words = inWords(output);
  return words === undefined
    ? 'Its result is too long to repeat here; the whole of it is in the details below.'
    : asSentence(`Its result: ${words}`);
}

export function makeOrchestration({ client }: OrchestrationDependencies): Primitive {
  return definePrimitive({
    name: 'orchestration',
    title: 'Orchestration',
    description: orchestrationDescription,
    noun: { one: 'workflow', other: 'workflows' },
    describeOutput: describeResult,
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
