import { describe, expect, it } from 'vitest';

import { createBrain, getBrain, retireBrain } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

describe('get_brain', () => {
  it('is an org query at GET /brains/{brain} that may meet not_found', () => {
    expect(getBrain.registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      title: 'Get brain',
      route: { method: 'GET', path: '/brains/{brain}' },
      pathParameters: ['brain'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('reads a brain, active or retired', async () => {
    const { call } = harness();
    const reading = (brain: string) => call(getBrain, toAcme(acmeAdmin, { brain }));
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha', description: 'Answers sales' }));
    await call(createBrain, toAcme(acmeAdmin, { brain: 'beta', name: 'Beta' }));
    await call(retireBrain, toAcme(acmeAdmin, { brain: 'beta' }), later);

    expect(await reading('alpha')).toStrictEqual({
      status: 'done',
      output: {
        id: 'alpha',
        name: 'Alpha',
        description: 'Answers sales',
        status: 'active',
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: firstMoment,
      },
    });
    expect(await reading('beta')).toMatchObject({ status: 'done', output: { status: 'retired', retired_at: later } });
  });
});

describe('get_brain refusing', () => {
  it('a brain the org does not have', async () => {
    const { call } = harness();

    expect(await call(getBrain, toAcme(acmeAdmin, { brain: 'nowhere' }))).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
  });

  it('a malformed id and a field the operation does not know', async () => {
    const { call } = harness();

    expect(await call(getBrain, toAcme(acmeAdmin, { brain: 'no_where', verbose: true }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/verbose' }, { pointer: '/brain' }],
    });
  });
});
