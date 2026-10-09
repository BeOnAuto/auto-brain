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
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect, Result, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { parseComputationDocument } from '../document/document-parsing.ts';
import { computationRun } from '../run/computation-run.ts';
import { computationBounds } from '../run/run-bounds.ts';

export interface ComputationFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly deadlineMs?: number;
}

function parse(source: string): Effect.Effect<ComputationFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseComputationDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: `The computation function definition has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}`,
          issues: issues.map((issue) => ({ pointer: '', detail: issueText(issue) })),
        }),
      ),
  });
}

function summarize({ description, input, output }: ComputationFunctionDefinitionDocument): DefinitionSummary {
  return {
    ...(description === undefined ? {} : { description }),
    ...(input.schema === undefined ? {} : { inputSchema: input.schema.document }),
    ...(output.schema === undefined ? {} : { outputSchema: output.schema.document }),
  };
}

function describeResult(output: Schema.Json): string {
  const words = inWords(output);
  return words === undefined
    ? 'Its result is too long to repeat here; the whole of it is in the details below.'
    : asSentence(`Its result: ${words}`);
}

export function makeComputationFunctionAdapter({
  pool,
  deadlineMs = computationBounds.deadlineMs,
}: ComputationFunctionAdapterOptions): Capability {
  const run = computationRun({ pool, deadlineMs });
  return defineCapability({
    type: 'computation',
    title: functionCategoryLabels.compute,
    guide: { name: 'computation-function' },
    noun: { one: functionResourceLabels.compute.singular, other: functionResourceLabels.compute.plural },
    describeOutput: describeResult,
    mediaType: 'text/markdown',
    parse,
    summarize,
    run: (document, input) => run(document, input),
    longestAnyRunMs: deadlineMs,
  });
}
