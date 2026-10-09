import { defineCapability, inWords, type RunContext, type FinishesLater, type Capability } from '@beonauto/definitions';
import { asSentence, Conflict, type InvalidInput, type Unavailable } from '@beonauto/operations';
import type { StartAnswer, WorkflowHost } from '@beonauto/workflow-host';
import { Effect, Random, type Schema } from 'effect';

import { checkedExpressions, type ExpressionCheck } from '../document/expression-check.ts';
import {
  readWorkflowDocument,
  runnableDocument,
  type ReadWorkflow,
  type WorkflowDefinitionDocument,
} from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { longestCallsOf } from '../runs/call-limits.ts';
import { unavailableUnless } from '../runs/host-refusals.ts';
import type { RunAttributes } from '../runs/run-attributes.ts';

export interface WorkflowAdapterDependencies {
  readonly runs: Pick<WorkflowHost, 'start'>;
  readonly check: ExpressionCheck;
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

function finishedLaterOr(answer: StartAnswer): Effect.Effect<FinishesLater, Conflict> {
  return answer === 'settled'
    ? Effect.fail(new Conflict({ detail: ranBefore, kind: 'unworkable' }))
    : Effect.succeed({ finishesLater: true, record: {} });
}

function started(
  { runs, mostDurationMs, longestCallMs }: WorkflowAdapterDependencies,
  document: WorkflowDefinitionDocument,
  input: Schema.Json,
  { id, org, brain, caller, definition, lineage, depth, callDepth, longestRunOf }: RunContext,
): Effect.Effect<FinishesLater, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const seed = yield* Random.nextIntBetween(0, mostSeed);
    const attributes: RunAttributes = {
      org,
      brain,
      run_id: id,
      definition,
      caller,
      depth,
      call_depth: callDepth,
      lineage: { start: lineage.startId, correlation: lineage.correlationId },
    };
    const longestCallMsByTask = yield* longestCallsOf(document, longestRunOf);
    const limits = { mostDurationMs, longestCallMs, longestCallMsByTask };
    const answer = yield* runs
      .start({ org, brain, runId: id }, { document, input, limits, attributes, seed })
      .pipe(Effect.mapError(unavailableUnless(notNow)));
    return yield* finishedLaterOr(answer);
  });
}

export function makeWorkflowAdapter(dependencies: WorkflowAdapterDependencies): Capability {
  return defineCapability({
    type: 'workflow',
    title: 'Workflow',
    guide: { name: 'workflow' },
    noun: { one: 'workflow', other: 'workflows' },
    describeOutput: describeResult,
    mediaType: 'application/yaml',
    parse: (source: string): Effect.Effect<ReadWorkflow, InvalidInput> =>
      readWorkflowDocument(source, dependencies.mostDurationMs),
    check: checkedExpressions(dependencies.check),
    summarize: ({ document }) => summaryOf(document),
    run: ({ document }, input, run, stripped) =>
      started(dependencies, runnableDocument(document, stripped), input, run),
    whenCancelled: 'finish',
    finishesLater: true,
    longestRunOf: () => dependencies.mostDurationMs,
  });
}
