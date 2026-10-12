import { cursorOfParts, InvalidInput, textOfContent, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { lastPeriodOf } from '../build/uploaded-files.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { cellOf } from '../dataset/row-measures.ts';
import {
  isProjected,
  type PredictionFunctionDefinitionDocument,
  type ProjectedData,
} from '../document/prediction-document.ts';
import { datasetRead, windowOf } from '../files/build-reads.ts';
import { seriesRowsOf, type SeriesRows } from '../files/series-rows.ts';
import { periodsOfSeries } from '../files/window-reads.ts';
import { periodOfForm } from '../periods/grains.ts';

export interface SeriesWindow {
  readonly y: Readonly<Float32Array>;
  readonly x: Readonly<Float32Array> | null;
  readonly origin: number;
  readonly checkpoint: string | null;
}

export interface Asking {
  readonly playbook: PlaybookAddress;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly series: string;
  readonly now: number;
}

type WindowRefused = InvalidInput | Unavailable;

const notReady = new Unavailable({
  detail: "The dataset is still being built from the playbook's history; ask again once get_definition shows it live",
  kind: 'dataset_not_ready',
});

function unknownSeries(series: string): InvalidInput {
  const detail = `The dataset holds no series ${JSON.stringify(series)} in its window`;
  return new InvalidInput({ detail, issues: [{ pointer: '/series', detail }] });
}

function projectedWindow(ports: PredictionPorts, asking: Asking, data: ProjectedData) {
  const { document, playbook, now } = asking;
  const request = { database: ports.database, content: ports.ledger.content, playbook, document, now };
  return ports.database
    .readConsistently((read) =>
      Effect.gen(function* () {
        const row = yield* datasetRead(read, request);
        const span = windowOf(request);
        const kept = yield* periodsOfSeries(read, row, asking.series, span);
        if (kept.length === 0) {
          return yield* Effect.fail(unknownSeries(asking.series));
        }
        const byPeriod = new Map(kept.map((period) => [period.period, period]));
        const periods = Array.from({ length: span.last - span.first + 1 }, (_, at) => byPeriod.get(span.first + at));
        const width = data.features.length;
        return {
          y: Float32Array.from(periods, (period) => cellOf(period?.target, data.target.as) ?? Number.NaN),
          x:
            width === 0
              ? null
              : Float32Array.from(
                  periods.flatMap((period) =>
                    data.features.map(({ as }, at) => cellOf(period?.features[at], as) ?? Number.NaN),
                  ),
                ),
          origin: span.last,
          checkpoint: cursorOfParts([row.playbookKey, ...Option.getOrThrow(Option.fromNullishOr(row.checkpoint))]),
        };
      }),
    )
    .pipe(
      Effect.catchTags({
        dataset_files_refused: () => Effect.fail<WindowRefused>(notReady),
        database_failed: Effect.die,
      }),
    );
}

function uploadedWindow(rows: readonly SeriesRows[], asking: Asking): Effect.Effect<SeriesWindow, WindowRefused> {
  const { document, series } = asking;
  const grain = document.predicts.period;
  const found = rows.find((each) => each.series === series);
  if (found === undefined) {
    return Effect.fail(unknownSeries(series));
  }
  const last = lastPeriodOf(document, rows);
  const { window } = document.data;
  const width = document.data.features.length;
  const at = new Map(found.periods.map((form, index) => [Number(periodOfForm(grain, form)), index]));
  const positions = Array.from({ length: window }, (_, offset) => at.get(last - window + 1 + offset));
  return Effect.succeed({
    y: Float32Array.from(positions, (index) => (index === undefined ? Number.NaN : Number(found.values[index]))),
    x:
      width === 0
        ? null
        : Float32Array.from(
            positions.flatMap((index) =>
              Array.from({ length: width }, (_, column) =>
                index === undefined ? Number.NaN : Number(found.features[index * width + column]),
              ),
            ),
          ),
    origin: last,
    checkpoint: null,
  });
}

function uploadedRowsOf(
  ports: PredictionPorts,
  { playbook, document }: Asking,
  sha256: string,
): Effect.Effect<readonly SeriesRows[]> {
  return Effect.flatMap(ports.ledger.content.get(playbook, sha256), (content) =>
    Effect.map(textOfContent(Option.getOrThrow(Option.fromNullishOr(content))), (text) =>
      seriesRowsOf(text, document.data.features.length),
    ),
  );
}

export function seriesWindow(ports: PredictionPorts, asking: Asking): Effect.Effect<SeriesWindow, WindowRefused> {
  const { data } = asking.document;
  if (isProjected(data)) {
    return projectedWindow(ports, asking, data);
  }
  return Effect.flatMap(uploadedRowsOf(ports, asking, data.dataset), (rows) => uploadedWindow(rows, asking));
}
