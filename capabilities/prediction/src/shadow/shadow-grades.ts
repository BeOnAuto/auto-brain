import { Schema, type Option } from 'effect';

import type { Score } from '../facts/build-facts.ts';
import type { ShadowGrade } from '../models/model-state.ts';
import type { Metric } from '../scoring/score-math.ts';
import { meanOf, quantileLoss, rounded, winklerScore, type Interval } from '../scoring/score-math.ts';
import type { Truthful } from './shadow-truths.ts';

const PredictionsSchema = Schema.fromJsonString(
  Schema.Struct({
    origin: Schema.String,
    series: Schema.Array(
      Schema.Struct({ series: Schema.String, q: Schema.Array(Schema.Number), scale: Schema.NullOr(Schema.Number) }),
    ),
  }),
);

export type Predictions = typeof PredictionsSchema.Type;

export const predictionsOf: (text: string) => Option.Option<Predictions> =
  Schema.decodeUnknownOption(PredictionsSchema);

export interface Aimed {
  readonly predictions: Predictions;
  readonly horizon: number | null;
}

interface Losses {
  readonly mase: readonly number[];
  readonly winkler: readonly number[];
  readonly quantile: readonly number[];
}

interface AimedLosses {
  readonly horizon: number | null;
  readonly losses: Losses;
  readonly missing: number;
}

interface Weighted {
  readonly value: number;
  readonly pairs: number;
}

export interface Graded {
  readonly scores: readonly Score[];
  readonly graded: number;
  readonly missing: number;
}

function intervalAt(q: readonly number[], step: number): Interval {
  return { low: Number(q[step * 3]), mid: Number(q[step * 3 + 1]), high: Number(q[step * 3 + 2]) };
}

function lossesOf(
  { predictions, horizon }: Aimed,
  { truths, absentIsZero }: Truthful,
): { readonly losses: Losses; readonly missing: number } {
  const losses = { mase: new Array<number>(), winkler: new Array<number>(), quantile: new Array<number>() };
  let missing = 0;
  for (const { series, q, scale } of predictions.series) {
    const truth = truths.get(series) ?? (absentIsZero ? 0 : undefined);
    const interval = intervalAt(q, horizon === null ? 0 : horizon - 1);
    if (truth === undefined || ![interval.low, interval.mid, interval.high].every((value) => Number.isFinite(value))) {
      missing += 1;
    } else {
      if (scale !== null && scale > 0) {
        losses.mase.push(Math.abs(truth - interval.mid) / scale);
      }
      losses.winkler.push(winklerScore(truth, interval));
      losses.quantile.push(quantileLoss(truth, interval));
    }
  }
  return { losses, missing };
}

export function gradeOf(aimed: readonly Aimed[], truthful: Truthful): Graded {
  const each = aimed.map((one): AimedLosses => ({ horizon: one.horizon, ...lossesOf(one, truthful) }));
  return {
    scores: each.map(({ horizon, losses }) => ({
      horizon,
      pairs: losses.winkler.length,
      mase: rounded(meanOf(losses.mase)),
      winkler: rounded(meanOf(losses.winkler)),
      quantile: rounded(meanOf(losses.quantile)),
    })),
    graded: each.reduce((total, { losses }) => total + losses.winkler.length, 0),
    missing: each.reduce((total, { missing }) => total + missing, 0),
  };
}

function figureOf(grades: readonly ShadowGrade[], metric: Metric): number | null {
  const weighted = grades.flatMap(({ scores }) =>
    scores.flatMap((score): readonly Weighted[] => {
      const value = score[metric];
      return value === null ? [] : [{ value, pairs: score.pairs }];
    }),
  );
  const pairs = weighted.reduce((total, { pairs: counted }) => total + counted, 0);
  return pairs === 0
    ? null
    : rounded(weighted.reduce((total, { value, pairs: counted }) => total + value * counted, 0) / pairs);
}

export interface Verdict {
  readonly passed: boolean;
  readonly challenger: number | null;
  readonly active: number | null;
}

export function shadowVerdictOf(grades: readonly ShadowGrade[], version: number, metric: Metric): Verdict {
  const challenger = figureOf(
    grades.filter(({ version: of, of: graded }) => of === version && graded === version),
    metric,
  );
  const active = figureOf(
    grades.filter(({ version: of, of: graded }) => of === version && graded !== version),
    metric,
  );
  return { passed: challenger === null || active === null || challenger <= active, challenger, active };
}
