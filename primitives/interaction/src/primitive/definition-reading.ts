import { InvalidInput } from '@beonauto/operations';
import type { DefinitionSummary } from '@beonauto/specs';
import { issueText } from '@beonauto/specs/document';
import { Effect, Result } from 'effect';

import { parseInteractionDocument } from '../document/document-parsing.ts';
import type { InteractionFunctionDefinitionDocument } from '../document/interaction-document.ts';

export function parse(source: string): Effect.Effect<InteractionFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseInteractionDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: `The interaction function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
          issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
        }),
      ),
  });
}

function deliveryOf({ route }: InteractionFunctionDefinitionDocument) {
  return route === undefined ? {} : { deliver: { server: route.deliver.server, tool: route.deliver.tool } };
}

export function summarize(document: InteractionFunctionDefinitionDocument): DefinitionSummary {
  const { description, input, output, expires } = document;
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...(output.schema === undefined ? {} : { outputSchema: output.schema.document }),
    details: { expires, ...deliveryOf(document) },
  };
}
