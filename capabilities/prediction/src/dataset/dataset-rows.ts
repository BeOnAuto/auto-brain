import { pointIn, WholeNumber, type Point, type RowPhase } from '@on.auto/workflow-host';
import { Schema } from 'effect';

import { decodeStoredData, type DatasetData } from './dataset-data.ts';

export interface DatasetStanding {
  readonly phase: RowPhase;
  readonly checkpoint: Point | undefined;
  readonly checkpointAt: string | null;
  readonly rows: number;
  readonly series: number;
  readonly firstPeriod: string | null;
  readonly lastPeriod: string | null;
  readonly eventsFolded: number;
  readonly passedOver: number;
}

export interface DatasetRow extends DatasetStanding {
  readonly playbookKey: string;
  readonly dataSha256: string;
  readonly saved: number;
  readonly checkpointText: string;
  readonly data: DatasetData;
}

const Text = Schema.NullOr(Schema.String);

export const StoredDatasetSchema = Schema.Struct({
  playbook_key: Schema.String,
  data_sha256: Schema.String,
  saved: WholeNumber,
  phase: Schema.Literals(['waiting', 'rebuilding', 'live', 'stalled']),
  checkpoint: Schema.String,
  checkpoint_at: Text,
  rows: WholeNumber,
  series: WholeNumber,
  first_period: Text,
  last_period: Text,
  events_folded: WholeNumber,
  passed_over: WholeNumber,
  data: Schema.String,
});

export function datasetRowOf(stored: typeof StoredDatasetSchema.Type): DatasetRow {
  return {
    playbookKey: stored.playbook_key,
    dataSha256: stored.data_sha256,
    saved: stored.saved,
    phase: stored.phase,
    checkpointText: stored.checkpoint,
    checkpoint: pointIn(stored.checkpoint),
    checkpointAt: stored.checkpoint_at,
    rows: stored.rows,
    series: stored.series,
    firstPeriod: stored.first_period,
    lastPeriod: stored.last_period,
    eventsFolded: stored.events_folded,
    passedOver: stored.passed_over,
    data: decodeStoredData(stored.data),
  };
}

export function standingOf(row: DatasetRow): DatasetStanding {
  const { phase, checkpoint, checkpointAt, rows, series, firstPeriod, lastPeriod, eventsFolded, passedOver } = row;
  return { phase, checkpoint, checkpointAt, rows, series, firstPeriod, lastPeriod, eventsFolded, passedOver };
}
