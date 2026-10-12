import { Buffer } from 'node:buffer';

import { sha256Of } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { writtenDatasetFiles } from '../files/dataset-files.ts';
import { weeklyOrdersWith } from '../testing/weekly-orders.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { foldedFor, moving, readBack, refusalOf, sixteenWeeksOfOrders } from './written-files.ts';

const testTimeoutMs = 30_000;

const anyText: unknown = expect.any(String);

const anyNumber: unknown = expect.any(Number);

const sixteenWeeks = weeklyOrdersWith(
  ['  season: 52', ''],
  ['  window: 156', '  window: 16'],
  ['  holdout: 12', '  holdout: 8'],
);

const figures = {
  rows: 32,
  series: 2,
  seriesLeftOut: 1,
  firstPeriod: '2026-W26',
  lastPeriod: '2026-W41',
  window: 16,
  holdout: 8,
  checkpoint: anyText,
};

function writtenTest(settingsOf: SettingsOf): void {
  it(
    'writes the scoring rows of the window whole and the training rows without the held-back periods, under their digests, sorted by series then period, one row a series and period',
    async () => {
      const { document, content, request } = await foldedFor(await settingsOf(), sixteenWeeks, sixteenWeeksOfOrders);
      const files = await Effect.runPromise(writtenDatasetFiles(request));
      const scoring = await readBack(content, files.scoring.sha256);
      const training = await readBack(content, files.training.sha256);
      const lines = scoring.split('\r\n');

      expect(files).toMatchObject({ dataSha256: document.dataSha256, ...figures });
      expect([sha256Of(scoring), files.scoring.bytes, sha256Of(training)]).toEqual([
        files.scoring.sha256,
        Buffer.byteLength(scoring),
        files.training.sha256,
      ]);
      expect(lines.slice(0, 2)).toEqual([
        'series,period,orders,basket,promotion',
        '"east, ""the coast""",2026-W26,0,,',
      ]);
      expect(lines.slice(17, 19)).toEqual(['north,2026-W26,1,26,', 'north,2026-W27,1,27,']);
      expect(lines.slice(31, 34)).toEqual(['north,2026-W40,2,30,1', 'north,2026-W41,1,,', '']);
      expect(training.split('\r\n')).toEqual([...lines.slice(0, 9), ...lines.slice(17, 25), '']);
    },
    testTimeoutMs,
  );
}

function refusedTest(settingsOf: SettingsOf): void {
  it(
    'refuses a dataset still being built and one past the bytes a build takes, and gives up on one that folds on while it is read',
    async () => {
      const { datasets, document, request } = await foldedFor(await settingsOf(), sixteenWeeks, sixteenWeeksOfOrders);
      const unsaved = { ...request, document: { ...document, dataSha256: 'f'.repeat(64) } };
      const always = moving(datasets.database, () => true);

      expect(await refusalOf(unsaved)).toMatchObject({ refusal: { kind: 'not_ready', phase: 'missing' } });
      expect(await refusalOf({ ...request, mostBytes: 100 })).toMatchObject({
        refusal: { kind: 'too_large', bytes: anyNumber },
        detail:
          'The rows take more than the 67108864 bytes a build takes as CSV; narrow the window, the series or the features',
      });
      expect(await refusalOf({ ...request, database: always })).toMatchObject({ refusal: { kind: 'changing' } });
    },
    testTimeoutMs,
  );
}

export function datasetFilesSuite(settingsOf: SettingsOf): void {
  describe('the two files a build reads', () => {
    writtenTest(settingsOf);
    refusedTest(settingsOf);
  });
}
