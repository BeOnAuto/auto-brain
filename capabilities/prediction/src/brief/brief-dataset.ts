import type { Schema } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isProjected, type DataPart, type Evaluation, type Predicts } from '../document/prediction-document.ts';
import { civilDay } from '../periods/civil-days.ts';
import { periodForm, periodOfDay } from '../periods/grains.ts';
import type { BriefVariables } from './brief-template.ts';

export interface BriefParts {
  readonly predicts: Predicts;
  readonly data: DataPart;
  readonly evaluation: Evaluation;
  readonly rules: readonly string[];
}

interface DatasetFigures {
  readonly name: string;
  readonly rows: number;
  readonly series: number;
  readonly lastPeriod: number;
}

const longestName = `p${'x'.repeat(47)}`;

const latestDay = civilDay({ year: 9999, month: 12, day: 31 });

function featuresOf(data: DataPart): Schema.JsonArray {
  return isProjected(data)
    ? data.features.map(({ name, as }) => ({ name, as, given: data.given.includes(name) }))
    : data.features.map((name) => ({ name, as: null, given: data.given.includes(name) }));
}

function briefVariablesOf(
  { predicts, data, evaluation, rules }: BriefParts,
  { name, rows, series, lastPeriod }: DatasetFigures,
): BriefVariables {
  const { period: grain, season, target, unit, horizons } = predicts;
  return {
    dataset: {
      rows,
      series,
      periods: {
        grain,
        season: season ?? null,
        first: periodForm(grain, lastPeriod - data.window + 1),
        last: periodForm(grain, lastPeriod),
      },
      window: data.window,
      holdout: evaluation.holdout,
      features: featuresOf(data),
      horizons: [...horizons],
    },
    function: { name, target, unit, rules: [...rules] },
  };
}

export function largestBriefVariables(parts: BriefParts): BriefVariables {
  return briefVariablesOf(parts, {
    name: longestName,
    rows: predictionBounds.mostDatasetRows,
    series: predictionBounds.mostDatasetSeries,
    lastPeriod: periodOfDay(parts.predicts.period, latestDay),
  });
}
