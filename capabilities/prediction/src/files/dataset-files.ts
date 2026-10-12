import { cursorOfParts } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isProjected, type ProjectedData } from '../document/prediction-document.ts';
import { periodForm } from '../periods/grains.ts';
import { datasetRead, keptFile, windowOf, type FilesRequest } from './build-reads.ts';
import { byUtf8 } from './csv-text.ts';
import { filesRefusedAs, type DatasetFiles, type DatasetFilesRefused } from './files-refusals.ts';
import { windowCountOf } from './window-reads.ts';

const { mostDatasetRows, mostDatasetSeries } = predictionBounds;

const triesWhileFolded = 3;

function writtenOnce(
  request: FilesRequest,
  data: ProjectedData,
): Effect.Effect<DatasetFiles | undefined, DatasetFilesRefused> {
  const { database, content, playbook, document } = request;
  return Effect.gen(function* () {
    const row = yield* datasetRead(request);
    const window = windowOf(request);
    const { holdout } = document.evaluation;
    const count = yield* Effect.orDie(
      windowCountOf(database, row, window, { leastObserved: holdout + 1, mostSeries: mostDatasetSeries }),
    );
    const rows = count.included.length * data.window;
    if (count.included.length > mostDatasetSeries || rows > mostDatasetRows) {
      return yield* Effect.fail(filesRefusedAs.tooLarge({ rows, series: count.included.length }));
    }
    const series = count.included.toSorted(byUtf8);
    const header = ['series', 'period', document.predicts.target, ...data.features.map(({ name }) => name)];
    const plan = { database, row, header, series, mostBytes: request.mostBytes ?? predictionBounds.mostDatasetBytes };
    const scoring = yield* keptFile(content, playbook, { ...plan, span: window });
    const training = yield* keptFile(content, playbook, {
      ...plan,
      span: { first: window.first, last: window.trainingLast },
    });
    const after = yield* datasetRead(request);
    return after.checkpointText === row.checkpointText
      ? {
          dataSha256: document.dataSha256,
          training: { sha256: training.sha256, bytes: training.bytes },
          scoring: { sha256: scoring.sha256, bytes: scoring.bytes },
          rows,
          series: series.length,
          seriesLeftOut: count.seriesInWindow - series.length,
          firstPeriod: periodForm(document.predicts.period, window.first),
          lastPeriod: periodForm(document.predicts.period, window.last),
          window: data.window,
          holdout,
          checkpoint: cursorOfParts([row.playbookKey, ...Option.getOrThrow(Option.fromNullishOr(row.checkpoint))]),
        }
      : undefined;
  });
}

export function writtenDatasetFiles(request: FilesRequest): Effect.Effect<DatasetFiles, DatasetFilesRefused> {
  const { data } = request.document;
  if (!isProjected(data)) {
    return Effect.fail(filesRefusedAs.uploaded());
  }
  const tried = (left: number): Effect.Effect<DatasetFiles, DatasetFilesRefused> =>
    Effect.flatMap(writtenOnce(request, data), (files) => {
      if (files !== undefined) {
        return Effect.succeed(files);
      }
      return left > 1 ? tried(left - 1) : Effect.fail(filesRefusedAs.changing());
    });
  return tried(triesWhileFolded);
}
