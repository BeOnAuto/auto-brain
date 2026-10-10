import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  outputInWords,
  type Capability,
} from '@beonauto/definitions';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';
import type { ViewsPort } from '@beonauto/workflow-host';

import { recallBounds, recallDefinitionType } from '../run/recall-bounds.ts';
import { recallRun } from '../run/recall-run.ts';
import { parse, summarize } from './recall-definitions.ts';
import { recallStanding } from './recall-standing.ts';

export interface RecallFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly views: ViewsPort;
  readonly mostFunctions?: number;
  readonly deadlineMs?: number;
}

export function makeRecallFunctionAdapter({
  pool,
  views,
  mostFunctions = recallBounds.mostFunctions,
  deadlineMs = recallBounds.deadlineMs,
}: RecallFunctionAdapterOptions): Capability {
  const run = recallRun({ pool, views, deadlineMs });
  return defineCapability({
    type: recallDefinitionType,
    title: functionCategoryLabels.recall,
    guide: { name: 'recall-function' },
    noun: { one: functionResourceLabels.recall.singular, other: functionResourceLabels.recall.plural },
    describeOutput: outputInWords('result'),
    mediaType: 'text/markdown',
    parse,
    summarize,
    run: (document, input, context) => run(document, input, context),
    longestAnyRunMs: deadlineMs,
    mostActive: mostFunctions,
    standing: recallStanding(views),
  });
}
