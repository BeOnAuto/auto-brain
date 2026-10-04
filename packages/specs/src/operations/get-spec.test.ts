import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, getSpec, retireSpec } = specOperationsFor([echo, probe().primitive]);

const toAlpha = toBrain('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

async function withActiveAndRetiredSpecs() {
  const specs = harness();
  await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain', source: 'text' }));
  await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'stale', source: 'old' }));
  await specs.call(retireSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'stale' }), later);
  return specs;
}

describe('get_spec', () => {
  it('is a brain query at GET /specs/{primitive}/{name} that may meet not_found', () => {
    expect(getSpec.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'Get spec',
      route: { method: 'GET', path: '/specs/{primitive}/{name}' },
      pathParameters: ['primitive', 'name'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('reads a spec with its document, active or retired, from JSON and from a query string', async () => {
    const { call } = await withActiveAndRetiredSpecs();

    expect(await call(getSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'plain' }))).toStrictEqual({
      status: 'succeeded',
      output: {
        primitive: 'probe',
        name: 'plain',
        version: 1,
        status: 'active',
        media_type: 'text/plain',
        created_at: firstMoment,
        created_by: 'acme-admin',
        updated_at: firstMoment,
        source: 'text',
      },
    });
    expect(await call(getSpec, asQueryString(toAlpha(acmeAdmin, { primitive: 'probe', name: 'stale' })))).toMatchObject(
      { status: 'succeeded', output: { status: 'retired', retired_at: later, source: 'old' } },
    );
  });
});

describe('get_spec rejecting', () => {
  it('a spec the primitive does not have in the brain, and a primitive it does not know', async () => {
    const { call } = await withActiveAndRetiredSpecs();

    expect(await call(getSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo spec plain in this brain',
    });
    expect(await call(getSpec, toAlpha(acmeAdmin, { primitive: 'reason', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no primitive reason',
    });
  });

  it('a malformed name and a field the operation does not know', async () => {
    expect(
      await harness().call(getSpec, toAlpha(acmeAdmin, { primitive: 'probe', name: 'no_where', verbose: true })),
    ).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/verbose' }, { pointer: '/name' }] });
  });
});
