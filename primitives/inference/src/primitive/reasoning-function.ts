import { asSentence, InvalidInput } from '@beonauto/operations';
import {
  definePrimitive,
  functionCategoryLabels,
  functionResourceLabels,
  inWords,
  type DefinitionSummary,
  type Primitive,
} from '@beonauto/specs';
import { Effect, Result, type Schema } from 'effect';

import type { OfferedModels } from '../model/offered-models.ts';
import { issueText } from '../spec/document-issue.ts';
import type { ReasoningFunctionDefinitionDocument } from '../spec/reasoning-function-definition.ts';
import { parseSpecDocument } from '../spec/spec-parsing.ts';
import { reasoningDescriptionFor } from './reasoning-description.ts';
import { specExecution, type ExecutionServices } from './spec-execution.ts';
import { longestRequestMs } from './spec-request.ts';

export interface ReasoningFunctionAdapterOptions extends ExecutionServices {
  readonly offered: OfferedModels;
}

function parse(source: string): Effect.Effect<ReasoningFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseSpecDocument(source), {
    onSuccess: (spec) => Effect.succeed(spec),
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

export function makeReasoningFunctionAdapter(options: ReasoningFunctionAdapterOptions): Primitive {
  const execute = specExecution(options);
  return definePrimitive({
    name: 'inference',
    title: functionCategoryLabels.reason,
    description: reasoningDescriptionFor(options.offered),
    noun: { one: functionResourceLabels.reason.singular, other: functionResourceLabels.reason.plural },
    describeOutput: describeAnswer,
    mediaType: 'text/markdown',
    parse,
    summarize,
    execute: (spec, input, execution) => execute(spec, input, execution),
    longestExecutionMs: longestRequestMs,
    reachesOutside: true,
  });
}
