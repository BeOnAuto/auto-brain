import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createBrain, retireBrain, updateBrain } from '../index.ts';
import { acmeAdmin, acmeAlphaKeeper } from '../testing/callers.ts';
import { firstMoment, harness, toOrg } from '../testing/harness.ts';

const toAcme = toOrg('acme');

const later = '2026-10-02T14:15:00.000Z';

async function withAlpha() {
  const brains = harness();
  await brains.call(createBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha', description: 'Answers sales' }));
  return brains;
}

describe('update_brain', () => {
  it('is an org command at PUT /brains/{brain} that may meet not_found and conflict', () => {
    expect(updateBrain.registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      title: 'Update brain',
      route: { method: 'PUT', path: '/brains/{brain}' },
      pathParameters: ['brain'],
      successStatus: 200,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('replaces the trimmed name and description, keeping who created the brain and when', async () => {
    const { call } = await withAlpha();
    const update = { brain: 'alpha', name: ' Alpha Sales ', description: ' ' };

    expect(await call(updateBrain, toAcme(acmeAlphaKeeper, update), later)).toStrictEqual({
      status: 'succeeded',
      output: {
        id: 'alpha',
        name: 'Alpha Sales',
        description: '',
        status: 'active',
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: later,
      },
    });
  });

  it('succeeds and records nothing when nothing changes', async () => {
    const { call } = await withAlpha();
    const sameAgain = { brain: 'alpha', name: 'Alpha', description: 'Answers sales' };

    expect(await call(updateBrain, toAcme(acmeAdmin, sameAgain), later)).toMatchObject({
      status: 'succeeded',
      output: { name: 'Alpha', updated_at: firstMoment },
    });
  });
});

describe('the input of update_brain', () => {
  it('needs both the name and the description, held to their limits', async () => {
    const { call } = await withAlpha();
    const updating = (input: object) => call(updateBrain, toAcme(acmeAdmin, { brain: 'alpha', ...input }));

    expect(await updating({ name: 'Alpha Sales' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/description', detail: 'Missing key' }],
    });
    expect(await updating({ name: '', description: 'd'.repeat(2001) })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/name' }, { pointer: '/description' }],
    });
  });

  it('rejects a field the operation does not know', async () => {
    const { call } = await withAlpha();

    expect(
      await call(updateBrain, toAcme(acmeAdmin, { brain: 'alpha', name: 'Alpha', description: '', status: 'retired' })),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/status', detail: 'Expected no excess property' }],
    });
  });
});

describe('update_brain rejecting', () => {
  it('a brain the org does not have, and a retired brain', async () => {
    const { call } = await withAlpha();
    const renaming = (brain: string) =>
      call(updateBrain, toAcme(acmeAdmin, { brain, name: 'Renamed', description: '' }));
    await call(retireBrain, toAcme(acmeAdmin, { brain: 'alpha' }));

    expect(await renaming('nowhere')).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
    expect(await renaming('alpha')).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The brain alpha is retired and can no longer change',
      kind: 'retired',
    });
  });

  it("with conflict when the org's brains changed while it decided", async () => {
    const { dispatch, run } = await withAlpha();
    await run(dispatch(createBrain, toAcme(acmeAdmin, { brain: 'beta', name: 'Beta' })));
    const renaming = (brain: string) =>
      dispatch(updateBrain, toAcme(acmeAdmin, { brain, name: 'Renamed', description: '' }));

    expect(await run(Effect.all([renaming('alpha'), renaming('beta')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { id: 'alpha', name: 'Renamed' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
