import { describe, expect, it } from 'vitest';

import { getRun } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, harness, toBrain } from '../testing/harness.ts';

const { createDefinition, runDefinition } = definitionOperationsFor([echo]);

const toAlpha = toBrain('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function withRun() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  await definitions.call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: runId }));
  return definitions;
}

describe('get_run', () => {
  it('is a brain query at GET /runs/{run_id} that may meet not_found', () => {
    expect(getRun.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'Get run',
      route: { method: 'GET', path: '/runs/{run_id}' },
      pathParameters: ['run_id'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('reads a run by its id in any case, from JSON and from a query string', async () => {
    const { call } = await withRun();
    const found = { status: 'succeeded', output: { run_id: runId, status: 'succeeded' } };

    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId.toUpperCase() }))).toMatchObject(found);
    expect(await call(getRun, asQueryString(toAlpha(acmeAdmin, { run_id: runId })))).toMatchObject(found);
  });
});

describe('get_run rejecting', () => {
  it('an id the brain has no run for', async () => {
    const { call } = await withRun();
    const unknownId = '0199a3c4-7d2e-7c1a-9b3f-000000000000';

    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: unknownId }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: `There is no run ${unknownId} in this brain`,
    });
  });

  it('an id that is not a UUID and a field the operation does not know', async () => {
    expect(await harness().call(getRun, toAlpha(acmeAdmin, { run_id: 'latest', type: 'echo' }))).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/capability' }, { pointer: '/run_id', detail: 'Expected a UUID' }],
    });
  });
});
