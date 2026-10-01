import { describe, expect, it } from 'vitest';

import { createBrain, getBrain, listBrains, retireBrain, updateBrain } from '../index.ts';
import { acmeAdmin, acmeAlphaKeeper, acmeReader, globexAdmin } from '../testing/callers.ts';
import { harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const toGlobex = toOrg('globex');

const renamed = { name: 'Renamed', description: '' };

describe('the brains of two orgs', () => {
  it('are apart even when they share an id', async () => {
    const { call } = harness();
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Acme Alpha' }));
    await call(createBrain, toGlobex(globexAdmin, { brain: 'alpha', name: 'Globex Alpha' }));
    await call(updateBrain, toAcme(acmeAdmin, { brain: 'alpha', ...renamed }));
    await call(retireBrain, toGlobex(globexAdmin, { brain: 'alpha' }));

    expect(await call(getBrain, toAcme(acmeAdmin, { brain: 'alpha' }))).toMatchObject({
      output: { name: 'Renamed', status: 'active', created_by: 'acme-admin' },
    });
    expect(await call(getBrain, toGlobex(globexAdmin, { brain: 'alpha' }))).toMatchObject({
      output: { name: 'Globex Alpha', status: 'retired', created_by: 'globex-admin' },
    });
    expect(await call(listBrains, toAcme(acmeAdmin))).toMatchObject({ output: { brains: [{ name: 'Renamed' }] } });
    expect(await call(listBrains, toGlobex(globexAdmin))).toMatchObject({ output: { brains: [] } });
  });

  it('are out of reach of a caller of the other org, whether they exist or not', async () => {
    const { call } = harness();
    await call(createBrain, toGlobex(globexAdmin, { brain: 'gamma', name: 'Gamma' }));
    const foreign = { status: 'refused', reason: 'forbidden', detail: 'The caller does not belong to this org' };
    const attempts = ['gamma', 'nowhere'].flatMap((brain) => [
      call(getBrain, toGlobex(acmeAdmin, { brain })),
      call(updateBrain, toGlobex(acmeAdmin, { brain, ...renamed })),
      call(retireBrain, toGlobex(acmeAdmin, { brain })),
    ]);

    expect(await Promise.all(attempts)).toEqual([foreign, foreign, foreign, foreign, foreign, foreign]);
    expect(await call(createBrain, toGlobex(acmeAdmin, { brain: 'delta', name: 'Delta' }))).toEqual(foreign);
    expect(await call(listBrains, toGlobex(acmeAdmin))).toEqual(foreign);
    expect(await call(getBrain, toGlobex(globexAdmin, { brain: 'gamma' }))).toMatchObject({
      output: { name: 'Gamma', status: 'active' },
    });
  });
});

describe('a caller limited to some brains', () => {
  it('is refused every other brain, whether it exists or not, and sees only its own listed', async () => {
    const { call } = harness();
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    await call(createBrain, toAcme(acmeAdmin, { brain: 'beta', name: 'Beta' }));
    const outOfReach = { status: 'refused', reason: 'forbidden', detail: 'The caller may not reach this brain' };
    const attempts = ['beta', 'nowhere'].flatMap((brain) => [
      call(getBrain, toAcme(acmeAlphaKeeper, { brain })),
      call(updateBrain, toAcme(acmeAlphaKeeper, { brain, ...renamed })),
      call(retireBrain, toAcme(acmeAlphaKeeper, { brain })),
    ]);

    expect(await Promise.all(attempts)).toEqual([
      outOfReach,
      outOfReach,
      outOfReach,
      outOfReach,
      outOfReach,
      outOfReach,
    ]);
    expect(await call(listBrains, toAcme(acmeAlphaKeeper, { include_retired: true }))).toMatchObject({
      output: { brains: [{ id: 'alpha' }] },
    });
    expect(await call(updateBrain, toAcme(acmeAlphaKeeper, { brain: 'alpha', ...renamed }))).toMatchObject({
      output: { id: 'alpha', name: 'Renamed' },
    });
    expect(await call(getBrain, toAcme(acmeAdmin, { brain: 'beta' }))).toMatchObject({
      output: { name: 'Beta', status: 'active' },
    });
  });
});

describe('creating a brain', () => {
  it('is open to a limited caller only for an id on its list, and to a caller of every brain for any', async () => {
    const { call } = harness();
    await call(createBrain, toAcme(acmeAdmin, { brain: 'beta', name: 'Beta' }));

    expect(await call(createBrain, toAcme(acmeAlphaKeeper, { brain: 'beta', name: 'Beta' }))).toEqual({
      status: 'refused',
      reason: 'forbidden',
      detail: 'The caller may not reach this brain',
    });
    expect(await call(createBrain, toAcme(acmeAlphaKeeper, { brain: 'delta', name: 'Delta' }))).toEqual({
      status: 'refused',
      reason: 'forbidden',
      detail: 'The caller may not reach this brain',
    });
    expect(await call(createBrain, toAcme(acmeAlphaKeeper, { brain: 'alpha', name: 'Alpha' }))).toMatchObject({
      status: 'done',
      output: { id: 'alpha', created_by: 'acme-alpha-keeper' },
    });
    expect(await call(createBrain, toAcme(acmeAdmin, { brain: 'delta', name: 'Delta' }))).toMatchObject({
      status: 'done',
      output: { id: 'delta', created_by: 'acme-admin' },
    });
  });
});

describe('a caller that may only read', () => {
  it('is refused the commands and served the queries', async () => {
    const { call } = harness();
    await call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha' }));
    const readOnly = { status: 'refused', reason: 'forbidden', detail: 'The caller lacks the org:write permission' };

    expect(await call(createBrain, toAcme(acmeReader, { brain: 'beta', name: 'Beta' }))).toEqual(readOnly);
    expect(await call(updateBrain, toAcme(acmeReader, { brain: 'alpha', ...renamed }))).toEqual(readOnly);
    expect(await call(retireBrain, toAcme(acmeReader, { brain: 'alpha' }))).toEqual(readOnly);
    expect(await call(getBrain, toAcme(acmeReader, { brain: 'alpha' }))).toMatchObject({
      output: { name: 'Alpha', status: 'active' },
    });
    expect(await call(listBrains, toAcme(acmeReader))).toMatchObject({ output: { brains: [{ id: 'alpha' }] } });
  });
});
