import { describe, expect, it } from 'vitest';

import { createBrain, listBrains, retireBrain } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { asQueryString, firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

const activeOnly = { status: 'done', output: { brains: [{ id: 'alpha' }, { id: 'gamma' }] } };

const retiredToo = {
  status: 'done',
  output: { brains: [{ id: 'alpha' }, { id: 'beta', status: 'retired', retired_at: later }, { id: 'gamma' }] },
};

function activeBrain(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    status: 'active',
    created_at: firstMoment,
    created_by: 'acme-admin',
    updated_at: firstMoment,
  };
}

async function withGammaAlphaAndRetiredBeta() {
  const brains = harness();
  await brains.call(createBrain, toAcme(acmeAdmin, { brain: 'gamma', name: 'Gamma' }));
  await brains.call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
  await brains.call(createBrain, toAcme(acmeAdmin, { brain: 'beta', name: 'Beta' }));
  await brains.call(retireBrain, toAcme(acmeAdmin, { brain: 'beta' }), later);
  return brains;
}

describe('list_brains', () => {
  it('is an org query at GET /brains that declares no refusal', () => {
    expect(listBrains.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      title: 'List brains',
      route: { method: 'GET', path: '/brains' },
      pathParameters: [],
      successStatus: 200,
      reasons: [],
    });
  });

  it('lists nothing for an org without brains', async () => {
    const { call } = harness();

    expect(await call(listBrains, toAcme(acmeAdmin))).toEqual({ status: 'done', output: { brains: [] } });
  });

  it('lists the active brains sorted by id', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();

    expect(await call(listBrains, toAcme(acmeAdmin))).toStrictEqual({
      status: 'done',
      output: { brains: [activeBrain('alpha', 'Alpha'), activeBrain('gamma', 'Gamma')] },
    });
  });
});

describe('include_retired', () => {
  it('lists the retired brains too when true in JSON', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) => call(listBrains, toAcme(acmeAdmin, input));

    expect(await listing({ include_retired: true })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: false })).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'true' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired', detail: 'Expected boolean' }],
    });
  });

  it('lists the retired brains too when true in a query string', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) => call(listBrains, asQueryString(toAcme(acmeAdmin, input)));

    expect(await listing({ include_retired: 'true' })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: 'false' })).toMatchObject(activeOnly);
    expect(await listing({})).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'yes' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired' }],
    });
  });

  it('is the only field list_brains knows', async () => {
    const { call } = harness();

    expect(await call(listBrains, toAcme(acmeAdmin, { status: 'retired' }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/status', detail: 'Expected no excess property' }],
    });
  });
});
