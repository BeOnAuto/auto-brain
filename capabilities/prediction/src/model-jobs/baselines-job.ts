import { seriesRowsIn } from '../files/series-rows.ts';
import { baselineWalk } from '../scoring/candidate-scoring.ts';
import { losesNothing } from '../scoring/metrics.ts';
import { scoringGridOf } from '../scoring/scoring-grid.ts';
import type { BaselinesJob } from './model-feeds.ts';

export interface BaselinesAnswer {
  readonly perfect: BaselinesJob['baselines'][number] | null;
}

export async function perfectBaselineIn(job: BaselinesJob): Promise<BaselinesAnswer> {
  const { period, horizons, accumulates, season, window, holdout, firstPeriod, metric } = job;
  const rows = await seriesRowsIn(job.rows, { features: 0 });
  const grid = scoringGridOf(
    {
      period,
      horizons,
      ...(accumulates === null ? {} : { accumulates }),
      ...(season === null ? {} : { season }),
    },
    { window, holdout, firstPeriod },
  );
  const perfect = job.baselines.find((baseline) =>
    losesNothing(grid, baselineWalk({ grid, rows }, baseline).forecasts, metric),
  );
  return { perfect: perfect ?? null };
}
