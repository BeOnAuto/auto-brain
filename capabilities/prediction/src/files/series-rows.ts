import { CsvReader, type CsvRecord } from '../upload/csv-records.ts';

export interface SeriesRows {
  readonly series: string;
  readonly periods: readonly string[];
  readonly values: Readonly<Float64Array>;
  readonly features: Readonly<Float64Array>;
}

function cellOf(field: string | undefined): number {
  return field === undefined || field === '' ? Number.NaN : Number(field);
}

function grouped(records: readonly CsvRecord[]): ReadonlyMap<string, readonly CsvRecord[]> {
  const bySeries = new Map<string, CsvRecord[]>();
  for (const record of records) {
    const [series = ''] = record.fields;
    const rows = bySeries.get(series);
    if (rows === undefined) {
      bySeries.set(series, [record]);
    } else {
      rows.push(record);
    }
  }
  return bySeries;
}

function seriesOf(series: string, rows: readonly CsvRecord[], features: number): SeriesRows {
  return {
    series,
    periods: rows.map(({ fields }) => fields[1] ?? ''),
    values: Float64Array.from(rows, ({ fields }) => cellOf(fields[2])),
    features: Float64Array.from(
      rows.flatMap(({ fields }) => Array.from({ length: features }, (_, index) => cellOf(fields[3 + index]))),
    ),
  };
}

export function seriesRowsOf(text: string, features: number): readonly SeriesRows[] {
  const reader = new CsvReader();
  const [, ...records] = [...reader.read(text), ...reader.end()];
  const all: SeriesRows[] = [];
  for (const [series, rows] of grouped(records)) {
    all.push(seriesOf(series, rows, features));
  }
  return all;
}
