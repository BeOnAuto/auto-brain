import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { builtFrom, modelFactsOf, savedFunction, standingOf } from '../build-testing/built-versions.ts';
import { activateVersion } from './activate-version.ts';

const testTimeoutMs = 60_000;

const anInstant: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);

describe('the activation of a version a caller asks for', { timeout: testTimeoutMs }, () => {
  it('activates a version it built again, as a rollback, whatever its shadow decided', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await builtFrom(playbook, ['visits-mean']);
    const second = await builtFrom(playbook, ['visits-steady']);
    const rolledBack = await playbook.send(activateVersion, { name: 'daily-visits', version: 1 });

    expect(rolledBack).toEqual({
      status: 'succeeded',
      output: { function: 'daily-visits', version: 1, rule: 'requested', activated_at: anInstant },
    });
    expect((await modelFactsOf(playbook)).map(({ type }) => type)).toEqual([
      'version_built',
      'shadow_passed',
      'version_activated',
      'version_built',
      'shadow_passed',
      'version_activated',
      'version_activated',
    ]);
    expect((await modelFactsOf(playbook)).at(4)).toMatchObject({ data: { version: 2, build: second } });
    expect(await standingOf(playbook)).toMatchObject({
      output: { standing: { models: { active: { version: 1 }, latest: 2, versions: 2 } } },
    });
  });

  it('refuses a version that is not built and the version that is active', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    await builtFrom(playbook, ['visits-mean']);

    expect([
      await playbook.send(activateVersion, { name: 'daily-visits', version: 2 }),
      await playbook.send(activateVersion, { name: 'other-visits', version: 1 }),
      await playbook.send(activateVersion, { name: 'daily-visits', version: 1 }),
    ]).toEqual([
      { status: 'rejected', reason: 'not_found', detail: 'Version 2 of daily-visits is not built' },
      { status: 'rejected', reason: 'not_found', detail: 'Version 1 of other-visits is not built' },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'already_active',
        detail: 'Version 1 of daily-visits is already active',
      },
    ]);
  });
});
