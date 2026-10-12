import {
  defineCapability,
  outputInWords,
  type BrainOwnNames,
  type Capability,
  type DeclaringCapability,
} from '@beonauto/definitions';
import type { InvalidInput } from '@beonauto/operations';
import type { Effect } from 'effect';

import { checkedExpressions, type ExpressionCheck } from '../document/expression-check.ts';
import { runnableDocument, workflowReaderOf, type ReadWorkflow } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { runPresenter } from '../presenting/run-presenter.ts';
import { started, type WorkflowStarts } from '../runs/run-start.ts';

export interface WorkflowAdapterDependencies extends WorkflowStarts {
  readonly check: ExpressionCheck;
  readonly names: BrainOwnNames;
}

export const workflowFacts: DeclaringCapability = { type: 'workflow', facts: { onRuns: [], streams: [runPresenter] } };

export function makeWorkflowAdapter(dependencies: WorkflowAdapterDependencies): Capability {
  const readWorkflowDocument = workflowReaderOf(dependencies.names);
  return defineCapability({
    type: workflowFacts.type,
    title: 'Workflow',
    guide: { name: 'workflow' },
    noun: { one: 'workflow', other: 'workflows' },
    describeOutput: outputInWords('result'),
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
    facts: workflowFacts.facts,
  });
}
