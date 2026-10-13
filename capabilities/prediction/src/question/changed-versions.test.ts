import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { asked, builtFrom, savedFunction, visitsRows } from '../build-testing/built-versions.ts';
import { uploadedDailyVisits } from '../testing/daily-documents.ts';

const testTimeoutMs = 60_000;

async function updated(playbook: BuildPlaybook, replaced: string, by: string): Promise<void> {
  expect(
    await playbook.call(playbook.operations.update, {
      type: 'prediction',
      name: 'daily-visits',
      source: uploadedDailyVisits(visitsRows.sha256).replace(replaced, by),
    }),
  ).toMatchObject({ status: 'succeeded' });
}

describe('a question after its function was edited', { timeout: testTimeoutMs }, () => {
  it('is answered by the active version after an edit that leaves the horizons, the given features and the total alone', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await builtFrom(playbook, ['visits-mean']);
    await updated(playbook, 'Fit a model', 'Fit one model');

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      output: { status: 'succeeded', output: { version: 1 } },
    });
  });

  it('is refused once the horizons changed since its version was built, as the data part changing is', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await builtFrom(playbook, ['visits-mean']);
    await updated(playbook, '  horizons: [1, 2]', '  horizons: [1]');

    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'data_changed',
      detail:
        'The horizons, the given features or the total changed since version 1 was built, so its model no longer fits the rows; ask for a build',
    });
  });
});
