import { textOfContent, type RecordedContent } from '@on.auto/operations';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import type { HostDatabase } from '@on.auto/workflow-host';
import { Effect, Option } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { FilesRequest } from '../files/build-reads.ts';
import { writtenDatasetFiles } from '../files/dataset-files.ts';
import { liveFolded } from './dataset-predicates.ts';
import { orderPlaced } from './orders.ts';
import { projectedDatasets, type ProjectedDatasets } from './projected-datasets.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const buildStart = Date.UTC(2026, 9, 12, 12);

export interface Folded {
  readonly datasets: ProjectedDatasets;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly content: RecordedContent;
  readonly request: FilesRequest;
}

function mondayOf(week: number): string {
  return new Date(Date.UTC(2025, 11, 29) + (week - 1) * 7 * 86_400_000 + 36_000_000).toISOString();
}

function weekly(region: string, weeks: readonly number[]) {
  return weeks.map((week) => orderPlaced({ region, at: mondayOf(week), total: week }));
}

export async function foldedFor(
  settings: Parameters<typeof projectedDatasets>[0],
  source: string,
  events: readonly ReturnType<typeof orderPlaced>[],
): Promise<Folded> {
  const datasets = await projectedDatasets(settings);
  const document = await datasets.saved('orders', source);
  await datasets.published(events);
  datasets.start();
  await datasets.until(document.dataSha256, liveFolded(events.length));
  const content = memoryRecordedContent();
  return {
    datasets,
    document,
    content,
    request: { database: datasets.database, content, playbook: alpha, document, now: buildStart },
  };
}

export const sixteenWeeksOfOrders = [
  ...weekly('north', [26, 27, 28, 29, 30, 31, 32, 33, 34, 40]),
  orderPlaced({ region: 'north', at: mondayOf(40), total: 20, promotion: 1 }),
  ...weekly('east, "the coast"', [30, 31, 32, 33, 34, 35, 36, 37, 38]),
  ...weekly('south', [40, 41]),
  ...weekly('north', [42]),
  orderPlaced({ region: 'north', at: mondayOf(41) }),
];

export async function readBack(content: RecordedContent, sha256: string): Promise<string> {
  const kept = Option.getOrThrow(Option.fromNullishOr(await Effect.runPromise(content.get(alpha, sha256))));
  return Effect.runPromise(textOfContent(kept));
}

export function refusalOf(request: FilesRequest): Promise<unknown> {
  return Effect.runPromise(Effect.flip(writtenDatasetFiles(request)));
}

const datasetRead = 'SELECT playbook_key, data_sha256, saved';

export function moving(database: HostDatabase, changesOn: (read: number) => boolean): HostDatabase {
  const reads = { datasets: 0 };
  return {
    ...database,
    read: (statement) =>
      Effect.map(database.read(statement), (rows) => {
        const named = String(statement.strings[0]).startsWith(datasetRead);
        reads.datasets += named ? 1 : 0;
        return named && changesOn(reads.datasets)
          ? rows.map((row) => Object.assign({}, row, { checkpoint: `["${reads.datasets}"]` }))
          : rows;
      }),
  };
}
