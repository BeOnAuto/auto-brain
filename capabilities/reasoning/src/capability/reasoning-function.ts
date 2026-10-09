import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  inWords,
  type DefinitionSummary,
  type Capability,
} from '@beonauto/definitions';
import { issueText } from '@beonauto/definitions/document';
import { asSentence, InvalidInput } from '@beonauto/operations';
import { Effect, Result, type Schema } from 'effect';

import { parseDefinitionDocument } from '../definition/definition-parsing.ts';
import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import type { OfferedModels } from '../model/offered-models.ts';
import { longestRequestMs, longestRunMsOf } from './definition-request.ts';
import { definitionRun, type RunServices } from './definition-run.ts';
import { onThisServer } from './on-this-server.ts';

export interface ReasoningFunctionAdapterOptions extends RunServices {
  readonly offered: OfferedModels;
}

function parse(source: string): Effect.Effect<ReasoningFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseDefinitionDocument(source), {
    onSuccess: (definition) => Effect.succeed(definition),
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: `The reasoning function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
          issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
        }),
      ),
  });
}

function summarize({ description, input, output, warnings }: ReasoningFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...(output.type === 'json' ? { outputSchema: output.schema.document } : {}),
    warnings,
  };
}

function describeAnswer(output: Schema.Json): string {
  const words = inWords(output);
  return words === undefined
    ? 'Its answer is too long to repeat here; the whole of it is in the details below.'
    : asSentence(`Its answer: ${words}`);
}

export function makeReasoningFunctionAdapter(options: ReasoningFunctionAdapterOptions): Capability {
  const run = definitionRun(options);
  return defineCapability({
    type: 'reasoning',
    title: functionCategoryLabels.reasoning,
    guide: {
      name: 'reasoning-function',
      onThisServer: onThisServer(options.offered, options.tools?.configured === true),
    },
    noun: { one: functionResourceLabels.reasoning.singular, other: functionResourceLabels.reasoning.plural },
    describeOutput: describeAnswer,
    mediaType: 'text/markdown',
    parse,
    summarize,
    run: (definition, input, context) => run(definition, input, context),
    longestAnyRunMs: longestRequestMs,
    longestRunOf: longestRunMsOf,
    reachesOutside: true,
    mayChangeOutside: options.tools?.configured === true,
    callsTools: ({ tools }) => tools.length > 0,
  });
}
