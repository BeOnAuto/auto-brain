import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  inWords,
  type Capability,
} from '@beonauto/definitions';
import { asSentence } from '@beonauto/operations';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import type { ViewsPort } from '@beonauto/workflow-host';
import type { Schema } from 'effect';

import { documentCheck } from '../document/document-check.ts';
import { recallBounds, recallDefinitionType } from '../run/recall-bounds.ts';
import { recallRun } from '../run/recall-run.ts';
import { parse, summarize } from './recall-definitions.ts';
import { recallStanding } from './recall-standing.ts';

export interface RecallFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
  readonly mostFunctions?: number;
  readonly deadlineMs?: number;
  readonly budget?: number;
  readonly memoryBytes?: number;
}

function describeResult(output: Schema.Json): string {
  const words = inWords(output);
  return words === undefined
    ? 'Its result is too long to repeat here; the whole of it is in the details below.'
    : asSentence(`Its result: ${words}`);
}

export function makeRecallFunctionAdapter({
  pool,
  views,
  mostFunctions = recallBounds.mostFunctions,
  deadlineMs = recallBounds.deadlineMs,
  budget = recallBounds.budget,
  memoryBytes = recallBounds.answerMemoryBytes,
}: RecallFunctionAdapterOptions): Capability {
  const run = recallRun({ pool, views, deadlineMs, budget, memoryBytes });
  return defineCapability({
    type: recallDefinitionType,
    title: functionCategoryLabels.recall,
    guide: { name: 'recall-function' },
    noun: { one: functionResourceLabels.recall.singular, other: functionResourceLabels.recall.plural },
    describeOutput: describeResult,
    mediaType: 'text/markdown',
    parse,
    check: documentCheck(pool),
    summarize,
    run: (document, input, context) => run(document, input, context),
    longestAnyRunMs: deadlineMs,
    mostActive: mostFunctions,
    standing: recallStanding(views),
  });
}
