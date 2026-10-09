import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  inWords,
  type DefinitionSummary,
  type Capability,
} from '@beonauto/definitions';
import { asSentence, type InvalidInput } from '@beonauto/operations';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import { Effect, Result, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { documentCheck, invalidDefinition } from '../document/document-check.ts';
import { parseComputationDocument } from '../document/document-parsing.ts';
import { computationRun } from '../run/computation-run.ts';
import { computationBounds } from '../run/run-bounds.ts';

export interface ComputationFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly deadlineMs?: number;
  readonly budget?: number;
  readonly memoryBytes?: number;
}

function parse(source: string): Effect.Effect<ComputationFunctionDefinitionDocument, InvalidInput> {
  return Result.match(parseComputationDocument(source), {
    onSuccess: (document) => Effect.succeed(document),
    onFailure: (issues) => Effect.fail(invalidDefinition(issues)),
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
  budget = computationBounds.budget,
  memoryBytes = computationBounds.memoryBytes,
}: ComputationFunctionAdapterOptions): Capability {
  const run = computationRun({ pool, deadlineMs, budget, memoryBytes });
  return defineCapability({
    type: 'computation',
    title: functionCategoryLabels.computation,
    guide: { name: 'computation-function' },
    noun: { one: functionResourceLabels.computation.singular, other: functionResourceLabels.computation.plural },
    describeOutput: describeResult,
    mediaType: 'text/markdown',
    parse,
    check: documentCheck(pool),
    summarize,
    run: (document, input) => run(document, input),
    longestAnyRunMs: deadlineMs,
  });
}
