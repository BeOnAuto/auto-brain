import { InvalidInput } from '@beonauto/operations';
import { definePrimitive, type Primitive, type SpecSummary } from '@beonauto/specs';
import { Effect, Result } from 'effect';

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

export function makeInference(options: InferenceOptions): Primitive {
  const execute = specExecution(options);
  return definePrimitive({
    name: 'inference',
    title: 'Inference',
    description: inferenceDescriptionFor(options.offered),
    mediaType: 'text/markdown',
    parse,
    summarize,
    execute: (spec, input, execution) => execute(spec, input, execution),
    longestExecutionMs: longestRequestMs,
  });
}
