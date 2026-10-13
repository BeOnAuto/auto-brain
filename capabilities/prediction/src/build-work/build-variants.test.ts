import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, builtFrom, runOf, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { candidateSha256 } from '../build-testing/due-driving.ts';
import { uploadedDailyTotals } from '../testing/daily-documents.ts';
import { dailyRows } from '../testing/daily-rows.ts';
import { uploadedWeeklyOrders } from '../testing/weekly-orders.ts';

const testTimeoutMs = 60_000;

const weekdaysAndWeekends = dailyRows('sales', ['north', 'south'], 56, (_series, day) => (day % 7 < 5 ? 10 : 14));

function weekOf(week: number): string {
  return `2026-W${String(week).padStart(2, '0')}`;
}

function weeklyText(): string {
  const weeks = Array.from({ length: 21 }, (_, at) => 20 + at);
  const lines = [
    'series,period,orders,basket,promotion',
    ...weeks.map((week) => `north,${weekOf(week)},5,10,${week % 2}`),
    ...weeks.map((week) => `south,${weekOf(week)},7,12,0`),
  ];
  const text = `${lines.join('\r\n')}\r\n`;
  return text;
}

const weeklyRows = { text: weeklyText(), sha256: createHash('sha256').update(weeklyText(), 'utf8').digest('hex') };

describe('a build of a function that predicts a total to the end of the week', { timeout: testTimeoutMs }, () => {
  it('scores the total against the run-rate, builds the version and answers the total to the end of the next week', async () => {
    const playbook = buildPlaybook();
    const source = uploadedDailyTotals(weekdaysAndWeekends.sha256).replace(
      '  holdout: 14',
      '  holdout: 14\n  baselines: [persistence]\n  coverage_floor: 0.6',
    );
    await savedFunction(playbook, { name: 'weekly-sales', rows: weekdaysAndWeekends, source });
    const build = await builtFrom(playbook, ['totals-run-rate'], 'weekly-sales');

    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'succeeded', output: { version: 1, winner: candidateSha256('totals-run-rate') } },
    });
    expect(await asked(playbook, { series: 'north' }, { name: 'weekly-sales' })).toMatchObject({
      output: {
        status: 'succeeded',
        output: { series: 'north', origin: '2026-10-25', period: '2026-W44', horizon: 7, value: 78, version: 1 },
      },
    });
  });
});

describe('a build of a function whose data has features and given features', { timeout: testTimeoutMs }, () => {
  it('feeds them to the candidate, scores no baseline that walks no series, and answers a question with its given', async () => {
    const playbook = buildPlaybook();
    const source = uploadedWeeklyOrders(weeklyRows.sha256).replace(
      '  holdout: 12',
      '  holdout: 12\n  baselines: [seasonal-naive]',
    );
    await savedFunction(playbook, { name: 'weekly-orders', rows: weeklyRows, source });
    const build = await builtFrom(playbook, ['orders-last'], 'weekly-orders');

    expect((await workOf(playbook, build)).at(-1)).toMatchObject({
      type: 'baseline_not_walked',
      data: { baseline: 'seasonal-naive', because: 'too_short' },
    });
    expect(
      await asked(playbook, { series: 'north', horizon: 4, given: { promotion: 1 } }, { name: 'weekly-orders' }),
    ).toMatchObject({
      output: {
        status: 'succeeded',
        output: { origin: '2026-W40', period: '2026-W44', horizon: 4, value: 5, low: 3, high: 7 },
      },
    });
  });
});
