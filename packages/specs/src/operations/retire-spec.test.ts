import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, executeSpec, retireSpec } = specOperationsFor([echo, probe().primitive]);

const toAlpha = toBrain('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const muchLater = '2026-11-20T08:00:00.000Z';

const retiringPlain = toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain' });

const retiredPlain = {
  primitive: 'probe',
  name: 'plain',
  version: 1,
  status: 'retired',
  media_type: 'text/plain',
  created_at: firstMoment,
  created_by: 'acme-admin',
  updated_at: later,
  retired_at: later,
  source: 'text',
};

async function withPlain() {
  const specs = harness();
  await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'text' }));
  return specs;
}

describe('retire_spec', () => {
  it('is a brain command at POST /specs/{primitive}/{name}/retire', () => {
    expect(retireSpec.registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      title: 'Retire spec',
      route: { method: 'POST', path: '/specs/{primitive}/{name}/retire' },
      pathParameters: ['primitive', 'name'],
      successStatus: 200,
      reasons: ['not_found', 'conflict'],
    });
  });

  it('retires a spec for good, recording when', async () => {
    const { call } = await withPlain();

    expect(await call(retireSpec, retiringPlain, later)).toStrictEqual({ status: 'succeeded', output: retiredPlain });
  });

  it('succeeds and records nothing for a spec that is already retired', async () => {
    const { call } = await withPlain();
    await call(retireSpec, retiringPlain, later);

    expect(await call(retireSpec, retiringPlain, muchLater)).toStrictEqual({
      status: 'succeeded',
      output: retiredPlain,
    });
  });

  it('leaves a spec that can no longer be executed', async () => {
    const { call } = await withPlain();
    await call(retireSpec, retiringPlain);

    expect(await call(executeSpec, retiringPlain)).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The probe spec plain is retired and can no longer be executed',
      kind: 'retired',
    });
  });
});

describe('retire_spec rejecting', () => {
  it('a spec the brain does not have, and a primitive it does not know', async () => {
    const { call } = await withPlain();

    expect(await call(retireSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo spec plain in this brain',
    });
    expect(await call(retireSpec, toAlpha(acmeAdmin, { primitive: 'prompt', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no primitive prompt',
    });
  });

  it('with conflict when another change to the specs of the primitive landed at the same moment', async () => {
    const { call, dispatch, run } = await withPlain();
    await call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'other', source: 'text' }));
    const retiring = (name: string) => dispatch(retireSpec, toAlpha(acmeAdmin, { primitive: 'probe', name }));

    expect(await run(Effect.all([retiring('plain'), retiring('other')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { name: 'plain', status: 'retired' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
