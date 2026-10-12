import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
  type CapabilityFacts,
} from '@beonauto/definitions';
import type { ProgramPool } from '@beonauto/workflow-engine/dsl';

import type { DatasetsPort } from '../dataset/datasets-port.ts';
import { predictionRun } from '../run/prediction-run.ts';
import { finishesLater, finishesLaterFor, longestRunFor, longestRunOf } from '../run/run-lengths.ts';
import { predictionBounds, predictionDefinitionType } from './prediction-bounds.ts';
import { predictionCheck } from './prediction-check.ts';
import { parse, summarize } from './prediction-definitions.ts';
import { predictionStanding } from './prediction-standing.ts';
import { describeOutput } from './prediction-words.ts';

export interface PredictionFunctionAdapterOptions {
  readonly pool: ProgramPool;
  readonly datasets: DatasetsPort;
  readonly mostFunctions?: number;
}

export const predictionFacts: CapabilityFacts = { onRuns: [], streams: [] };

export function makePredictionFunctionAdapter({
  pool,
  datasets,
  mostFunctions = predictionBounds.mostFunctions,
}: PredictionFunctionAdapterOptions): Capability {
  return defineCapability({
    type: predictionDefinitionType,
    title: functionCategoryLabels.prediction,
    guide: { name: 'prediction-function' },
    noun: { one: functionResourceLabels.prediction.singular, other: functionResourceLabels.prediction.plural },
    describeOutput,
    mediaType: 'text/markdown',
    parse,
    check: predictionCheck(pool),
    summarize,
    run: (document, input) => predictionRun(document, input),
    finishesLater,
    finishesLaterFor,
    longestRunOf,
    longestRunFor,
    mostActive: mostFunctions,
    standing: predictionStanding(datasets),
    facts: predictionFacts,
  });
}
