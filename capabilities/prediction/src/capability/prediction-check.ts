import { noStrippedForms, type SavedDefinitions, type StrippedForms } from '@beonauto/definitions';
import { checkedAtSave, type CheckedDocument } from '@beonauto/definitions/check';
import { reportedIssues, type DocumentIssue } from '@beonauto/definitions/document';
import type { InvalidInput, Unavailable } from '@beonauto/operations';
import type { CheckIssue, ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { calledFunctionIssues } from './called-functions.ts';
import { invalidDefinition } from './prediction-definitions.ts';

export type PredictionCheck = (
  document: PredictionFunctionDefinitionDocument,
  source: string,
  saved: SavedDefinitions,
) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;

const dataNames = ['$data'];

const nothingToCheck: CheckedDocument = { stripped: noStrippedForms };

function expressionsChecked(
  pool: ProgramPool,
  { dataExpressions }: PredictionFunctionDefinitionDocument,
): Effect.Effect<CheckedDocument, InvalidInput | Unavailable> {
  return dataExpressions.length === 0
    ? Effect.succeed(nothingToCheck)
    : checkedAtSave(pool, {
        schemas: {},
        expressions: dataExpressions.map(({ source }) => ({ source, names: dataNames })),
      });
}

function placedIssues(
  { dataExpressions }: PredictionFunctionDefinitionDocument,
  issues: readonly CheckIssue[],
): readonly DocumentIssue[] {
  return dataExpressions.flatMap(({ pointer, line: first }, index) =>
    issues.filter(({ at }) => at === index).map(({ line, detail }) => ({ line: first + line - 1, pointer, detail })),
  );
}

export function predictionCheck(pool: ProgramPool): PredictionCheck {
  return (document, _source, saved) =>
    Effect.gen(function* () {
      const called = yield* calledFunctionIssues(document, saved);
      const checked = yield* expressionsChecked(pool, document);
      if ('issues' in checked) {
        return yield* Effect.fail(
          invalidDefinition(reportedIssues([...called, ...placedIssues(document, checked.issues)])),
        );
      }
      return called.length > 0 ? yield* Effect.fail(invalidDefinition(reportedIssues(called))) : checked.stripped;
    });
}
