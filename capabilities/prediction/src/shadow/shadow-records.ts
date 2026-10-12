import { readFile } from 'node:fs/promises';

import { Array, Effect } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { seriesRowsOf } from '../files/series-rows.ts';
import type { WalkAnswer } from '../process/model-processes.ts';
import { scaleOf } from '../scoring/baselines.ts';
import { featureNamesOf } from '../scoring/scoring-inputs.ts';
import type { ShadowRows } from './shadow-rows.ts';
import type { ShadowOrigin } from './shadow-schedule.ts';
import { shadowGridOf } from './shadow-walk.ts';

export function predictionsText(
  document: PredictionFunctionDefinitionDocument,
  origin: ShadowOrigin,
  rows: ShadowRows,
  answer: WalkAnswer | undefined,
): Effect.Effect<string> {
  const grid = shadowGridOf(document, rows);
  return Effect.map(
    Effect.promise(() => readFile(rows.path, 'utf8')),
    (text) => {
      const series =
        answer === undefined
          ? []
          : Array.zipWith(
              seriesRowsOf(text, featureNamesOf(document).length),
              answer.q,
              ({ series: name, values }, q) => ({ series: name, q: [...q], scale: scaleOf(grid, values) ?? null }),
            );
      return JSON.stringify({ origin: origin.form, series });
    },
  );
}
