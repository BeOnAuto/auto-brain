import {
  listedPhrases,
  named,
  paragraph,
  sectionOf,
  type OverviewBlock,
  type OverviewSection,
} from '@on.auto/definitions';

import {
  isProjected,
  type Baseline,
  type Evaluation,
  type PredictionFunctionDefinitionDocument,
} from '../document/prediction-document.ts';
import { periodsOf } from './predicts-words.ts';

const metricWords: Readonly<Record<Evaluation['metric'], string>> = {
  mase: 'its mean absolute scaled error',
  winkler: 'the Winkler score of its interval',
  quantile: 'the quantile loss of its percentiles',
};

const baselineWords: Readonly<Record<Baseline, string>> = {
  persistence: 'the last value carried forward',
  'seasonal-naive': 'the value one season earlier',
};

const share = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 });

function shadowBlocks({ data, predicts, evaluation }: PredictionFunctionDefinitionDocument): readonly OverviewBlock[] {
  const { shadowPeriods } = evaluation;
  return shadowPeriods === 0 || !isProjected(data)
    ? []
    : [
        paragraph(
          `A version after the first runs beside the active one for ${periodsOf(predicts.accumulates ?? predicts.period, shadowPeriods)}, and takes its place only when it predicts no worse.`,
        ),
      ];
}

function activationBlock({ activate }: Evaluation): OverviewBlock {
  return activate === 'automatic'
    ? paragraph('A version that passes becomes the active one on its own.')
    : paragraph(
        'A version that passes becomes the active one once it is approved through the interaction function ',
        named(activate.approved),
        '.',
      );
}

export function goingLiveSection(document: PredictionFunctionDefinitionDocument): OverviewSection {
  const { evaluation, predicts } = document;
  const { holdout, metric, coverageFloor, baselines, confidence } = evaluation;
  const beaten = baselines.map((baseline) => [named(baseline), ` (${baselineWords[baseline]})`]);
  return sectionOf(
    'How a version goes live',
    paragraph(
      `The playbook holds back the last ${periodsOf(predicts.period, holdout)} of the window from the trainer, and scores each candidate on them by ${metricWords[metric]}.`,
    ),
    paragraph(
      `A candidate passes when its interval holds at least ${share.format(coverageFloor)} of the truths and it beats `,
      ...listedPhrases(beaten, 'and'),
      ` with ${share.format(confidence)} confidence; the best that passes becomes the next version.`,
    ),
    ...shadowBlocks(document),
    activationBlock(evaluation),
  );
}
