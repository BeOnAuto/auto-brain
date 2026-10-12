import {
  streamPrefixOfPlaybook,
  type ContentKept,
  type PlaybookAddress,
  type RecordedContent,
} from '@on.auto/operations';
import { rowsOf, type HostDatabase } from '@on.auto/workflow-host';
import { Effect, Result } from 'effect';

import { datasetRowOf, StoredDatasetSchema, type DatasetRow } from '../dataset/dataset-rows.ts';
import { datasetNamed } from '../dataset/dataset-statements.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { periodOfMoment } from '../periods/moments.ts';
import { csvStream, DatasetTooLarge, type CsvPlan } from './dataset-csv.ts';
import { filesRefusedAs, type DatasetFilesRefused, type WindowOfTheBuild } from './files-refusals.ts';

export interface FilesRequest {
  readonly database: HostDatabase;
  readonly content: Pick<RecordedContent, 'put'>;
  readonly playbook: PlaybookAddress;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly now: number;
  readonly mostBytes?: number;
}

export function datasetRead({
  database,
  playbook,
  document,
}: FilesRequest): Effect.Effect<DatasetRow, DatasetFilesRefused> {
  const read = datasetNamed(streamPrefixOfPlaybook(playbook), document.dataSha256);
  return rowsOf(StoredDatasetSchema, database.read(read)).pipe(
    Effect.orDie,
    Effect.flatMap(([stored]) => {
      const row = stored === undefined ? undefined : datasetRowOf(stored);
      return row?.phase === 'live'
        ? Effect.succeed(row)
        : Effect.fail(filesRefusedAs.notReady(row?.phase ?? 'missing'));
    }),
  );
}

export function windowOf({ document, now }: FilesRequest): WindowOfTheBuild {
  const last = periodOfMoment(document.predicts.period, now) - 1;
  const { window } = document.data;
  return { first: last - window + 1, last, trainingLast: last - document.evaluation.holdout };
}

export function keptFile(
  content: FilesRequest['content'],
  playbook: PlaybookAddress,
  plan: CsvPlan,
): Effect.Effect<ContentKept, DatasetFilesRefused> {
  return Effect.gen(function* () {
    const put = yield* Effect.result(content.put(playbook, { stream: csvStream(plan), mediaType: 'text/csv' }));
    if (Result.isSuccess(put)) {
      return put.success;
    }
    const { cause } = put.failure;
    return yield* cause instanceof DatasetTooLarge
      ? Effect.fail(filesRefusedAs.tooLarge({ bytes: cause.bytes }))
      : Effect.die(cause);
  });
}
