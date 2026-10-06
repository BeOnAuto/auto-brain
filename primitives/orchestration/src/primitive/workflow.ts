import { asSentence, Conflict, InvalidInput, type Unavailable } from '@beonauto/operations';
import { definePrimitive, inWords, type RunContext, type FinishesLater, type Primitive } from '@beonauto/specs';
import { measureOf, mostValueDepth } from '@beonauto/workflow-engine';
import type { StartAnswer, WorkflowHost } from '@beonauto/workflow-host';
import { Effect, Random, type Schema } from 'effect';

import { parseWorkflowDocument, type WorkflowDefinitionDocument } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { unavailableUnless } from '../runs/host-refusals.ts';
import type { RunAttributes } from '../runs/run-attributes.ts';
import { workflowDescription } from './workflow-description.ts';

export interface WorkflowAdapterDependencies {
  readonly runs: Pick<WorkflowHost, 'start'>;
  readonly mostDurationMs: number;
  readonly longestCallMs: number;
}

const ranBefore =
  'This run ID already ran its workflow, which ended; a workflow runs once for a run ID, so use a new run ID to run it again';

const notNow = 'The workflow cannot start now; try again shortly';

const mostSeed = 2_147_483_647;

function describeResult(output: Schema.Json): string {
  const words = inWords(output);
  return words === undefined
    ? 'Its result is too long to repeat here; the whole of it is in the details below.'
    : asSentence(`Its result: ${words}`);
}

function admittedInput(input: unknown): Effect.Effect<void, InvalidInput> {
  const problem = `The input nests more than ${mostValueDepth} levels deep`;
  return measureOf(input) === undefined
    ? Effect.fail(new InvalidInput({ detail: problem, issues: [{ detail: problem, pointer: '' }] }))
    : Effect.void;
}

function finishedLaterOr(answer: StartAnswer): Effect.Effect<FinishesLater, Conflict> {
  return answer === 'settled'
    ? Effect.fail(new Conflict({ detail: ranBefore, kind: 'unworkable' }))
    : Effect.succeed({ finishesLater: true, record: {} });
}

function started(
  { runs, mostDurationMs, longestCallMs }: WorkflowAdapterDependencies,
  document: WorkflowDefinitionDocument,
  input: Schema.Json,
  { id, org, brain, caller, spec }: RunContext,
): Effect.Effect<FinishesLater, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const seed = yield* Random.nextIntBetween(0, mostSeed);
    const attributes: RunAttributes = { org, brain, execution_id: id, spec, caller };
    const answer = yield* runs
      .start(
        { org, brain, executionId: id },
        { document, input, limits: { mostDurationMs, longestCallMs }, attributes, seed },
      )
      .pipe(Effect.mapError(unavailableUnless(notNow)));
    return yield* finishedLaterOr(answer);
  });
}

export function makeWorkflowAdapter(dependencies: WorkflowAdapterDependencies): Primitive {
  return definePrimitive({
    name: 'orchestration',
    title: 'Workflow',
    description: workflowDescription,
    noun: { one: 'workflow', other: 'workflows' },
    describeOutput: describeResult,
    mediaType: 'application/yaml',
    parse: (source: string): Effect.Effect<WorkflowDefinitionDocument, InvalidInput> =>
      parseWorkflowDocument(source, dependencies.mostDurationMs),
    summarize: summaryOf,
    execute: (document, input, execution) =>
      admittedInput(input).pipe(Effect.andThen(started(dependencies, document, input, execution))),
    whenCancelled: 'finish',
  });
}
