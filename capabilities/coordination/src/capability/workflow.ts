import {
  defineCapability,
  outputInWords,
  type PlaybookOwnNames,
  type Capability,
  type DeclaringCapability,
} from '@on.auto/definitions';
import type { InvalidInput } from '@on.auto/operations';
import type { Effect } from 'effect';

import { checkedExpressions, type ExpressionCheck } from '../document/expression-check.ts';
import { runnableDocument, workflowReaderOf, type ReadWorkflow } from '../document/workflow-document.ts';
import { summaryOf } from '../document/workflow-summary.ts';
import { workflowOverview } from '../overview/workflow-overview.ts';
import { runPresenter } from '../presenting/run-presenter.ts';
import { started, type WorkflowStarts } from '../runs/run-start.ts';

export interface WorkflowAdapterDependencies extends WorkflowStarts {
  readonly check: ExpressionCheck;
  readonly names: PlaybookOwnNames;
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
    overview: workflowOverview,
    run: ({ document }, input, run, stripped) =>
      started(dependencies, runnableDocument(document, stripped), input, run),
    whenCancelled: 'finish',
    finishesLater: true,
    longestRunOf: () => dependencies.mostDurationMs,
    facts: workflowFacts.facts,
  });
}
