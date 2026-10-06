import { asSentence } from '@beonauto/operations';
import {
  definePrimitive,
  functionCategoryLabels,
  functionResourceLabels,
  inWords,
  type Primitive,
} from '@beonauto/specs';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import type { ViewsPort } from '@beonauto/workflow-host';
import type { Schema } from 'effect';

import { recallBounds, recallDefinitionType } from '../run/recall-bounds.ts';
import { recallRun } from '../run/recall-run.ts';
import { parse, summarize } from './recall-definitions.ts';
import { recallDescription } from './recall-description.ts';
import { recallStanding } from './recall-standing.ts';

export interface RecallFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
  readonly mostFunctions?: number;
  readonly deadlineMs?: number;
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
}: RecallFunctionAdapterOptions): Primitive {
  const run = recallRun({ pool, views, deadlineMs });
  return definePrimitive({
    name: recallDefinitionType,
    title: functionCategoryLabels.recall,
    description: recallDescription,
    noun: { one: functionResourceLabels.recall.singular, other: functionResourceLabels.recall.plural },
    describeOutput: describeResult,
    mediaType: 'text/markdown',
    parse,
    summarize,
    execute: (document, input, execution) => run(document, input, execution),
    longestExecutionMs: deadlineMs,
    mostActive: mostFunctions,
    standing: recallStanding(views),
  });
}
