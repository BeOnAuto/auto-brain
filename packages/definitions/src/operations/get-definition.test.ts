import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, firstMoment, harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';

const { createDefinition, getDefinition, retireDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toBrain('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

async function withActiveAndRetiredDefinitions() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }));
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'stale', source: 'old' }));
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'stale' }), later);
  return definitions;
}

describe('get_definition', () => {
  it('is a brain query at GET /definitions/{type}/{name} that may meet not_found', () => {
    expect(getDefinition.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'Get definition',
      route: { method: 'GET', path: '/definitions/{type}/{name}' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('reads a definition with its document, active or retired, from JSON and from a query string', async () => {
    const { call } = await withActiveAndRetiredDefinitions();

    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain' }))).toStrictEqual({
      status: 'succeeded',
      output: {
        type: 'probe',
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
    expect(
      await call(getDefinition, asQueryString(toAlpha(acmeAdmin, { type: 'probe', name: 'stale' }))),
    ).toMatchObject({ status: 'succeeded', output: { status: 'retired', retired_at: later, source: 'old' } });
  });
});

describe('get_definition rejecting', () => {
  it('a definition the capability does not have in the brain, and a capability it does not know', async () => {
    const { call } = await withActiveAndRetiredDefinitions();

    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo definition plain in this brain',
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'reason', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no capability reason',
    });
  });

  it('a malformed name and a field the operation does not know', async () => {
    expect(
      await harness().call(getDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'no_where', verbose: true })),
    ).toMatchObject({ reason: 'invalid_input', issues: [{ pointer: '/verbose' }, { pointer: '/name' }] });
  });
});
