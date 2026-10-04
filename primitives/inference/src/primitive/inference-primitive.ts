import { asSentence, InvalidInput } from '@beonauto/operations';
import { definePrimitive, inWords, type Primitive, type SpecSummary } from '@beonauto/specs';
import { Effect, Result, type Schema } from 'effect';

import type { OfferedModels } from '../model/offered-models.ts';
import { issueText } from '../spec/document-issue.ts';
import type { InferenceSpec } from '../spec/inference-spec.ts';
import { parseSpecDocument } from '../spec/spec-parsing.ts';
import { inferenceDescriptionFor } from './inference-description.ts';
import { specExecution, type ExecutionServices } from './spec-execution.ts';
import { longestRequestMs } from './spec-request.ts';

export interface InferenceOptions extends ExecutionServices {
  readonly offered: OfferedModels;
}

function parse(source: string): Effect.Effect<InferenceSpec, InvalidInput> {
  return Result.match(parseSpecDocument(source), {
    onSuccess: (spec) => Effect.succeed(spec),
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: `The inference spec document has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
          issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
        }),
      ),
  });
}

function summarize({ description, input, output, warnings }: InferenceSpec): SpecSummary {
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

export function makeInference(options: InferenceOptions): Primitive {
  const execute = specExecution(options);
  return definePrimitive({
    name: 'inference',
    title: 'Inference',
    description: inferenceDescriptionFor(options.offered),
    noun: { one: 'reason function', other: 'reason functions' },
    describeOutput: describeAnswer,
    mediaType: 'text/markdown',
    parse,
    summarize,
    execute: (spec, input, execution) => execute(spec, input, execution),
    longestExecutionMs: longestRequestMs,
  });
}
