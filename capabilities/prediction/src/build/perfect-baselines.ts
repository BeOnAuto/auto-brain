import { Conflict, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { Assembled } from '../facts/build-facts.ts';
import { seriesRowsIn } from '../files/series-rows.ts';
import { baselineWalk } from '../scoring/candidate-scoring.ts';
import { losesNothing } from '../scoring/metrics.ts';
import { featureNamesOf, gridOfTheBuild, rowsFileOf } from '../scoring/scoring-inputs.ts';

function perfectAs(baseline: string, metric: string): Conflict {
  return new Conflict({
    detail: `The baseline ${baseline} already scores 0 on ${metric} at every period held back where ${metric} scores it, the best a score can be, so no candidate can beat it; ask for a build once the series moves`,
    kind: 'baseline_perfect',
  });
}

export function noBaselinePerfect(
  ports: PredictionPorts,
  playbook: PlaybookAddress,
  document: PredictionFunctionDefinitionDocument,
  assembled: Assembled,
): Effect.Effect<void, Conflict> {
  return Effect.gen(function* () {
    const path = yield* rowsFileOf(ports, playbook, assembled.scoring_sha256);
    const features = featureNamesOf(document).length;
    const rows = yield* Effect.promise(() => seriesRowsIn(path, { features }));
    const grid = gridOfTheBuild(document, assembled);
    const { baselines, metric } = document.evaluation;
    const perfect = baselines.find((baseline) =>
      losesNothing(grid, baselineWalk({ grid, rows }, baseline).forecasts, metric),
    );
    return perfect === undefined ? undefined : yield* Effect.fail(perfectAs(perfect, metric));
  });
}
