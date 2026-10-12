import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@on.auto/definitions';

import { predictionFacts } from '../facts/prediction-facts.ts';
import { predictionRunsOn } from '../run/prediction-runs.ts';
import { predictionBounds, predictionDefinitionType } from './prediction-bounds.ts';
import { predictionCheck } from './prediction-check.ts';
import { parse, summarize } from './prediction-definitions.ts';
import type { PredictionFunctionAdapterOptions } from './prediction-ports.ts';
import { predictionStanding } from './prediction-standing.ts';
import { describeOutput } from './prediction-words.ts';

export function makePredictionFunctionAdapter({
  pool,
  datasets,
  ports,
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
    ...predictionRunsOn(ports),
    facts: predictionFacts,
    mostActive: mostFunctions,
    standing: predictionStanding(datasets, ports.ledger),
  });
}
