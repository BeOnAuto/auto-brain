import { DatabaseFailed, type HostDatabase } from '@beonauto/workflow-host';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parsePredictionDocument } from '../document/document-parsing.ts';
import { writtenDatasetFiles } from '../files/dataset-files.ts';
import { uploadedWeeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { orderPlaced } from './orders.ts';
import { foldedFor, moving, refusalOf } from './written-files.ts';

const testTimeoutMs = 60_000;

const thousandDays = weeklyOrdersWith(
  ['  period: week', '  period: day'],
  ['  season: 52', ''],
  ['  horizons: [1, 4]', '  horizons: [1]'],
  ['  target: { as: count }', '  target: { of: /total, as: last }'],
  ['  window: 156', '  window: 1000'],
  ['  holdout: 12', '  holdout: 8'],
);

const sixteenWeeks = weeklyOrdersWith(
  ['  season: 52', ''],
  ['  window: 156', '  window: 16'],
  ['  holdout: 12', '  holdout: 8'],
);

const uploaded = Result.getOrThrow(parsePredictionDocument(uploadedWeeklyOrders('c'.repeat(64))));

function daysOf(region: string) {
  return Array.from({ length: 9 }, (_, day) =>
    orderPlaced({ region, at: new Date(Date.UTC(2026, 9, 1 + day, 12)).toISOString(), total: day }),
  );
}

const manySeries = [
  ...Array.from({ length: 201 }, (_, region) => `r${String(region).padStart(3, '0')}`).flatMap((region) =>
    daysOf(region),
  ),
  orderPlaced({ region: 'rare', at: '2026-10-05T12:00:00Z', total: 1 }),
];

const nineWeeks = Array.from({ length: 9 }, (_, week) =>
  orderPlaced({ region: 'north', at: new Date(Date.UTC(2026, 6, 6 + week * 7, 10)).toISOString(), total: 1 }),
);

function failing(database: HostDatabase): HostDatabase {
  return {
    ...database,
    read: (statement) =>
      String(statement.strings[0]).startsWith('SELECT period_index')
        ? Effect.fail(new DatabaseFailed({ detail: 'The store was told to fail' }))
        : database.read(statement),
  };
}

function boundsTest(settingsOf: SettingsOf): void {
  it(
    'refuses rows past the 200,000 a build takes, counting only the series observed often enough, and a function that names an uploaded dataset',
    async () => {
      const { request } = await foldedFor(await settingsOf(), thousandDays, manySeries);

      expect(await refusalOf(request)).toMatchObject({
        refusal: { kind: 'too_large', rows: 201_000, series: 201 },
        detail:
          'The dataset holds 201000 rows over 201 series and a build takes 200000 rows over at most 1000 series; narrow the window or the series',
      });
      expect(await refusalOf({ ...request, document: uploaded })).toMatchObject({ refusal: { kind: 'uploaded' } });
    },
    testTimeoutMs,
  );
}

function rereadTest(settingsOf: SettingsOf): void {
  it(
    'reads the rows again when they folded on while read, and fails when the store fails while the rows are read',
    async () => {
      const { datasets, request } = await foldedFor(await settingsOf(), sixteenWeeks, nineWeeks);
      const once = moving(datasets.database, (read) => read === 2);
      const written = await Effect.runPromise(writtenDatasetFiles({ ...request, database: once }));
      const failed = await Effect.runPromiseExit(
        writtenDatasetFiles({ ...request, database: failing(datasets.database) }),
      );

      expect(written).toMatchObject({ rows: 16, series: 1 });
      expect(Exit.isFailure(failed)).toBe(true);
    },
    testTimeoutMs,
  );
}

export function datasetFilesBoundsSuite(settingsOf: SettingsOf): void {
  describe('the bounds of the files a build reads', () => {
    boundsTest(settingsOf);
    rereadTest(settingsOf);
  });
}
