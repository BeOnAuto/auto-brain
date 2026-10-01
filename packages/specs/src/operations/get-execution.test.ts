import { describe, expect, it } from 'vitest';

import { getExecution } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/echo.ts';
import { asQueryString, harness, toBrain } from '../testing/harness.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const { createSpec, executeSpec } = specOperationsFor([echo]);

const toAlpha = toBrain('acme', 'alpha');

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function withExecution() {
  const specs = harness();
  await specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }));
  await specs.call(executeSpec, toAlpha(acmeAdmin, { primitive: 'echo', name: 'greet', execution_id: executionId }));
  return specs;
}

describe('get_execution', () => {
  it('is a brain query at GET /executions/{execution_id} that may meet not_found', () => {
    expect(getExecution.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'Get execution',
      route: { method: 'GET', path: '/executions/{execution_id}' },
      pathParameters: ['execution_id'],
      successStatus: 200,
      reasons: ['not_found'],
    });
  });

  it('reads an execution by its id in any case, from JSON and from a query string', async () => {
    const { call } = await withExecution();
    const found = { status: 'succeeded', output: { execution_id: executionId, status: 'succeeded' } };

    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: executionId.toUpperCase() }))).toMatchObject(
      found,
    );
    expect(await call(getExecution, asQueryString(toAlpha(acmeAdmin, { execution_id: executionId })))).toMatchObject(
      found,
    );
  });
});

describe('get_execution rejecting', () => {
  it('an id the brain has no execution for', async () => {
    const { call } = await withExecution();
    const unknownId = '0199a3c4-7d2e-7c1a-9b3f-000000000000';

    expect(await call(getExecution, toAlpha(acmeAdmin, { execution_id: unknownId }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: `There is no execution ${unknownId} in this brain`,
    });
  });

  it('an id that is not a UUID and a field the operation does not know', async () => {
    expect(
      await harness().call(getExecution, toAlpha(acmeAdmin, { execution_id: 'latest', primitive: 'echo' })),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/primitive' }, { pointer: '/execution_id', detail: 'Expected a UUID' }],
    });
  });
});
