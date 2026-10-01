import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createBrain, retireBrain } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const retiredAlpha = {
  id: 'alpha',
  name: 'Alpha',
  description: '',
  status: 'retired',
  created_at: firstMoment,
  created_by: 'acme-admin',
  updated_at: later,
  retired_at: later,
};

describe('retire_brain', () => {
  it('is an org command at POST /brains/{brain}/retire that may meet not_found and conflict', () => {
    expect(retireBrain.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      title: 'Retire brain',
      route: { method: 'POST', path: '/brains/{brain}/retire' },
      pathParameters: ['brain'],
      successStatus: 200,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('retires a brain for good, recording when', async () => {
    const { call } = harness();
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));

    expect(await call(retireBrain, toAcme(acmeAdmin, { brain: 'alpha' }), later)).toStrictEqual({
      status: 'done',
      output: retiredAlpha,
    });
  });

  it('succeeds and records nothing for a brain that is already retired', async () => {
    const { call } = harness();
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    await call(retireBrain, toAcme(acmeAdmin, { brain: 'alpha' }), later);

    expect(await call(retireBrain, toAcme(acmeAdmin, { brain: 'alpha' }), muchLater)).toStrictEqual({
      status: 'done',
      output: retiredAlpha,
    });
  });
});

describe('retire_brain refusing', () => {
  it('a brain the org does not have', async () => {
    const { call } = harness();

    expect(await call(retireBrain, toAcme(acmeAdmin, { brain: 'nowhere' }))).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
  });

  it('a malformed id and a field the operation does not know', async () => {
    const { call } = harness();

    expect(await call(retireBrain, toAcme(acmeAdmin, { brain: 'al', reason: 'done' }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/reason' }, { pointer: '/brain' }],
    });
  });

  it("with conflict when the org's brains changed while it decided", async () => {
    const { dispatch, run } = harness();
    await run(dispatch(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' })));
    await run(dispatch(createBrain, toAcme(acmeAdmin, { brain: 'beta', name: 'Beta' })));
    const retiring = (brain: string) => dispatch(retireBrain, toAcme(acmeAdmin, { brain }));

    expect(await run(Effect.all([retiring('alpha'), retiring('beta')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'done', output: { id: 'alpha', status: 'retired' } },
      { status: 'refused', reason: 'conflict' },
    ]);
  });
});
