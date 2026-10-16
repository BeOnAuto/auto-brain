import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, askedBuild, runOf, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { dailyRows, steadyVisits } from '../testing/daily-rows.ts';

const runIds = ['0199a3c4-7d2e-7c1a-9b3f-555555555561', '0199a3c4-7d2e-7c1a-9b3f-555555555562'];

const stillFrom = 30;

function stillOf(series: string): number {
  return series === 'north' ? 10 : 20;
}

function stillSeries(series: string, day: number): number {
  return day < stillFrom ? steadyVisits(series, day) : stillOf(series);
}

function southMoving(series: string, day: number): number {
  return series === 'south' ? steadyVisits(series, day) : stillSeries(series, day);
}

const still = dailyRows('visits', ['north', 'south'], 40, stillSeries);

const oneMoving = dailyRows('visits', ['north', 'south'], 40, southMoving);

describe('a build whose baseline already predicts every period held back exactly', () => {
  it('is refused as it starts, before its brief is rendered or its trainer asked, and takes none of the builds of the day', async () => {
    const playbook = buildPlaybook({ bounds: { buildsPerDay: 1 } });
    await savedFunction(playbook, { rows: still });
    const refused = [
      await asked(playbook, { build: {} }, { runId: String(runIds[0]) }),
      await asked(playbook, { build: {} }, { runId: String(runIds[1]) }),
    ];

    expect(refused).toMatchObject(
      runIds.map(() => ({
        status: 'rejected',
        reason: 'conflict',
        kind: 'baseline_perfect',
        detail:
          'The baseline persistence already scores 0 on mase over every period held back, the best a score can be, so no candidate can beat it; ask for a build once the series moves',
      })),
    );
    expect(await Promise.all(runIds.map((runId) => workOf(playbook, runId)))).toEqual([[], []]);
    expect(await runOf(playbook, String(runIds[0]))).not.toHaveProperty('output.record');
    expect(await playbook.call(playbook.operations.interactions, {})).toMatchObject({
      output: { interactions: [] },
    });
  });
});

describe('a build whose baseline misses a period held back of one series', () => {
  it('goes ahead and asks its trainer', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook, { rows: oneMoving });
    const build = await askedBuild(playbook);

    expect(await workOf(playbook, build)).toMatchObject([{ type: 'dataset_assembled' }]);
    expect(await playbook.call(playbook.operations.interactions, {})).toMatchObject({
      output: { interactions: [{ run_id: build }] },
    });
  });
});
