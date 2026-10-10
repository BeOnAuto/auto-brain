import type { StrippedForms } from '@beonauto/definitions';
import { checkedAtSave } from '@beonauto/definitions/check';
import { issueText, reportedIssues, type DocumentIssue } from '@beonauto/definitions/document';
import { InvalidInput, type Unavailable } from '@beonauto/operations';
import type { CheckIssue, ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { ComputationFunctionDefinitionDocument } from './computation-document.ts';

export type DocumentCheck = (
  document: ComputationFunctionDefinitionDocument,
) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;

export function invalidDefinition(issues: readonly DocumentIssue[]): InvalidInput {
  return new InvalidInput({
    detail: `The computation function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
    issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
  });
}

function placed({ programLine }: ComputationFunctionDefinitionDocument, { line, detail }: CheckIssue): DocumentIssue {
  return { line: programLine + line - 1, pointer: '', detail };
}

export function documentCheck(pool: ProgramPool): DocumentCheck {
  return (document) => {
    const { input, output, program } = document;
    const job = {
      module: { place: 'computation' as const, source: program },
      schemas: {
        ...(input.schema === undefined ? {} : { input: input.schema.document }),
        ...(output.schema === undefined ? {} : { output: output.schema.document }),
      },
      expressions: [],
    };
    return checkedAtSave(pool, job).pipe(
      Effect.flatMap((checked) =>
        'stripped' in checked
          ? Effect.succeed(checked.stripped)
          : Effect.fail(invalidDefinition(reportedIssues(checked.issues.map((issue) => placed(document, issue))))),
      ),
    );
  };
}
