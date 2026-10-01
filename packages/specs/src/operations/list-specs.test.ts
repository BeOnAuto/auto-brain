import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, listSpecs, retireSpec } = specOperationsFor([echo, probe().primitive]);

const toAlpha = toBrain('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const activeOnly = { status: 'succeeded', output: { specs: [{ name: 'alpha' }, { name: 'gamma' }] } };

const retiredToo = {
  status: 'succeeded',
  output: { specs: [{ name: 'alpha' }, { name: 'beta', status: 'retired', retired_at: later }, { name: 'gamma' }] },
};

function listed(name: string) {
  return {
    primitive: 'probe',
    name,
    version: 1,
    status: 'active',
    media_type: 'text/plain',
    created_at: firstMoment,
    created_by: 'acme-admin',
    updated_at: firstMoment,
  };
}

async function withGammaAlphaAndRetiredBeta() {
  const specs = harness();
  const creating = (name: string) =>
    specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name, source: name }));
  await creating('gamma');
  await creating('alpha');
  await creating('beta');
  await specs.call(retireSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'beta' }), later);
  await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'delta', source: '{"greeting": "Hi"}' }));
  return specs;
}

describe('list_specs', () => {
  it('is a brain query at GET /specs/{primitive} that may meet not_found', () => {
    expect(listSpecs.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'List specs',
      route: { method: 'GET', path: '/specs/{primitive}' },
      pathParameters: ['primitive'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('lists nothing for a primitive without specs', async () => {
    expect(await harness().call(listSpecs, toAlpha(acmeAdmin, { primitive: 'echo' }))).toEqual({
      status: 'succeeded',
      output: { specs: [] },
    });
  });

  it('lists the active specs of the primitive sorted by name, without their documents', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();

    expect(await call(listSpecs, toAlpha(acmeAdmin, { primitive: 'probe' }))).toStrictEqual({
      status: 'succeeded',
      output: { specs: [listed('alpha'), listed('gamma')] },
    });
    expect(await call(listSpecs, toAlpha(acmeAdmin, { primitive: 'echo' }))).toMatchObject({
      output: { specs: [{ primitive: 'echo', name: 'delta', media_type: 'application/json' }] },
    });
  });

  it('rejects a primitive it does not know', async () => {
    expect(await harness().call(listSpecs, toAlpha(acmeAdmin, { primitive: 'inference' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no primitive inference',
    });
  });
});

describe('include_retired', () => {
  it('lists the retired specs too when true in JSON', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) => call(listSpecs, toAlpha(acmeAdmin, { primitive: 'probe', ...input }));

    expect(await listing({ include_retired: true })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: false })).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'true' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired', detail: 'Expected boolean' }],
    });
  });

  it('lists the retired specs too when true in a query string', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) =>
      call(listSpecs, asQueryString(toAlpha(acmeAdmin, { primitive: 'probe', ...input })));

    expect(await listing({ include_retired: 'true' })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: 'false' })).toMatchObject(activeOnly);
    expect(await listing({})).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'yes' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired' }],
    });
  });

  it('and primitive are the only fields list_specs knows', async () => {
    expect(
      await harness().call(listSpecs, toAlpha(acmeAdmin, { primitive: 'probe', status: 'retired' })),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/status', detail: 'Expected no excess property' }],
    });
  });
});
