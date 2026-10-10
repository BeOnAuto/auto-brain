import type { StrippedForms } from '@beonauto/definitions';
import { checkedAtSave } from '@beonauto/definitions/check';
import { issueText, reportedIssues, type DocumentIssue } from '@beonauto/definitions/document';
import { InvalidInput, type Unavailable } from '@beonauto/operations';
import type { CheckIssue, CheckJob, ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { RecallFunctionDefinitionDocument } from './recall-document.ts';

export type DocumentCheck = (
  document: RecallFunctionDefinitionDocument,
) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;

const filterNames = ['$data'];

export function invalidDefinition(issues: readonly DocumentIssue[]): InvalidInput {
  return new InvalidInput({
    detail: `The recall function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
    issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
  });
}

function jobOf({ input, output, details, filterExpressions }: RecallFunctionDefinitionDocument): CheckJob {
  return {
    module: { place: 'recall', source: details.fold },
    schemas: {
      ...(details.schema === undefined ? {} : { view: details.schema }),
      ...(input.schema === undefined ? {} : { input: input.schema.document }),
      ...(output.schema === undefined ? {} : { output: output.schema.document }),
    },
    expressions: filterExpressions.map(({ source }) => ({ source, names: filterNames })),
  };
}

function placedIssues(
  { details, filterExpressions }: RecallFunctionDefinitionDocument,
  issues: readonly CheckIssue[],
): readonly DocumentIssue[] {
  const ofModule = issues
    .filter(({ at }) => at === 'module')
    .map(({ line, detail }) => ({ line: details.foldLine + line - 1, pointer: '', detail }));
  const ofFilters = filterExpressions.flatMap(({ pointer, line: first }, index) =>
    issues.filter(({ at }) => at === index).map(({ line, detail }) => ({ line: first + line - 1, pointer, detail })),
  );
  return [...ofModule, ...ofFilters];
}

export function documentCheck(pool: ProgramPool): DocumentCheck {
  return (document) =>
    checkedAtSave(pool, jobOf(document)).pipe(
      Effect.flatMap((checked) =>
        'stripped' in checked
          ? Effect.succeed(checked.stripped)
          : Effect.fail(invalidDefinition(reportedIssues(placedIssues(document, checked.issues)))),
      ),
    );
}
