import type { InvalidInput, Unavailable } from '@beonauto/operations';
import { workflowExpressionsOf, type PlacedExpression } from '@beonauto/workflow-engine';
import type { CheckIssue, CheckJob } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

import { invalidDocument, notRunnable, placeOf, type LocatedIssue, type ReadWorkflow } from './workflow-document.ts';

export type ExpressionCheck = (job: CheckJob) => Effect.Effect<readonly CheckIssue[], Unavailable>;

function locatedIssues(
  { locate }: ReadWorkflow,
  expressions: readonly PlacedExpression[],
  issues: readonly CheckIssue[],
): readonly LocatedIssue[] {
  return expressions.flatMap(({ pointer }, index) => {
    const { line, column } = locate(pointer);
    return issues
      .filter(({ at }) => at === index)
      .map(({ line: within, detail }) => ({
        position: { line: line + within - 1, column },
        detail: `${placeOf(pointer)}${detail}`,
      }));
  });
}

export function checkedExpressions(
  check: ExpressionCheck,
): (read: ReadWorkflow) => Effect.Effect<void, InvalidInput | Unavailable> {
  return (read) => {
    const expressions = workflowExpressionsOf(read.document);
    if (expressions.length === 0) {
      return Effect.void;
    }
    const job = { schemas: {}, expressions: expressions.map(({ source, names }) => ({ source, names })) };
    return check(job).pipe(
      Effect.flatMap((issues) =>
        issues.length === 0
          ? Effect.void
          : Effect.fail(invalidDocument(notRunnable, locatedIssues(read, expressions, issues))),
      ),
    );
  };
}
