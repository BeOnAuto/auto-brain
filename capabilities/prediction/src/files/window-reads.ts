import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '@beonauto/workflow-host';
import { Effect, Schema } from 'effect';

import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { composed, each, type Piece } from '../dataset/dataset-statements.ts';
import { MeasureStateSchema, stateOf, type MeasureState } from '../dataset/row-measures.ts';

export interface WindowSpan {
  readonly first: number;
  readonly last: number;
}

export interface WindowCount {
  readonly included: readonly string[];
  readonly seriesInWindow: number;
}

export interface KeptPeriod {
  readonly period: number;
  readonly target: MeasureState;
  readonly features: readonly MeasureState[];
}

const IncludedSchema = Schema.Struct({ series: Schema.String });

const CountSchema = Schema.Struct({ counted: WholeNumber });

const KeptSchema = Schema.Struct({
  period_index: WholeNumber,
  target: Schema.NullOr(Schema.Number),
  target_count: WholeNumber,
  target_at: Schema.NullOr(WholeNumber),
  features: Schema.fromJsonString(Schema.Array(MeasureStateSchema)),
});

function inWindow(row: DatasetRow, { first, last }: WindowSpan): readonly Piece[] {
  return [
    ' FROM prediction_rows WHERE playbook_key = ',
    each([row.playbookKey]),
    ' AND data_sha256 = ',
    each([row.dataSha256]),
    ' AND period_index >= ',
    each([first]),
    ' AND period_index <= ',
    each([last]),
  ];
}

function observed(row: DatasetRow): string {
  const { as } = row.data.target;
  return as === 'count' || as === 'sum' ? '' : ' AND target_count > 0';
}

export function windowCountOf(
  database: HostDatabase,
  row: DatasetRow,
  span: WindowSpan,
  { leastObserved, mostSeries }: { readonly leastObserved: number; readonly mostSeries: number },
): Effect.Effect<WindowCount, DatabaseFailed> {
  const included = composed(
    'SELECT series',
    ...inWindow(row, span),
    observed(row),
    ' GROUP BY series HAVING COUNT(*) >= ',
    each([leastObserved]),
    ' LIMIT ',
    each([mostSeries + 1]),
  );
  const counted = composed('SELECT COUNT(DISTINCT series) AS counted', ...inWindow(row, span));
  return Effect.map(
    Effect.all([rowsOf(IncludedSchema, database.read(included)), rowsOf(CountSchema, database.read(counted))]),
    ([series, counts]: readonly [readonly { readonly series: string }[], readonly { readonly counted: number }[]]) => ({
      included: series.map(({ series: named }) => named),
      seriesInWindow: counts.reduce((total, count) => total + count.counted, 0),
    }),
  );
}

export function periodsOfSeries(
  database: HostDatabase,
  row: DatasetRow,
  series: string,
  span: WindowSpan,
): Effect.Effect<readonly KeptPeriod[], DatabaseFailed> {
  const read = composed(
    'SELECT period_index, target, target_count, target_at, features',
    ...inWindow(row, span),
    ' AND series = ',
    each([series]),
    ' ORDER BY period_index',
  );
  return Effect.map(rowsOf(KeptSchema, database.read(read)), (kept) =>
    kept.map((period) => ({
      period: period.period_index,
      target: { value: period.target, count: period.target_count, at: period.target_at },
      features: period.features.map((feature) => stateOf(feature)),
    })),
  );
}
