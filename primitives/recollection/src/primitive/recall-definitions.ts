import { InvalidInput } from '@beonauto/operations';
import type { DefinitionSummary } from '@beonauto/specs';
import { issueText } from '@beonauto/specs/document';
import { ViewDetailsSchema } from '@beonauto/workflow-host';
import { Effect, Result, Schema } from 'effect';

import { parseRecallDocument } from '../document/document-parsing.ts';
import type { RecallFunctionDefinitionDocument } from '../document/recall-document.ts';

const encodeDetails = Schema.encodeSync(ViewDetailsSchema);

export function parse(source: string): Effect.Effect<RecallFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseRecallDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: `The recall function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
          issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
        }),
      ),
  });
}

export function summarize({
  description,
  input,
  output,
  details,
}: RecallFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...(output.schema === undefined ? {} : { outputSchema: output.schema.document }),
    details: encodeDetails(details),
  };
}
