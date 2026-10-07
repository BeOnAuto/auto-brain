import { createApiKey } from '@beonauto/identity';
import { answers, textResult } from '@beonauto/inference/testing';
import { allPermissions } from '@beonauto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, brains: '*' });

const summary = '---\nmodel: anthropic/claude-sonnet-4-5\n---\nSummarize {{ input.text }}';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

let server: ReasoningServer;

beforeEach(async () => {
  server = await servingReasoning([answers(textResult('Done'))], {
    API_KEYS: JSON.stringify([acmeAdmin.entry, globexAdmin.entry]),
  });
  const acme = { key: acmeAdmin.key };
  await server.call('POST', '/v1/orgs/acme/brains', { ...acme, body: { brain: 'alpha', name: 'Alpha' } });
  await server.call('POST', '/v1/orgs/acme/brains', { ...acme, body: { brain: 'beta', name: 'Beta' } });
  await server.call('POST', '/v1/orgs/globex/brains', {
    key: globexAdmin.key,
    body: { brain: 'alpha', name: 'Globex alpha' },
  });
  await server.call('POST', '/v1/orgs/acme/brains/alpha/specs/inference', {
    ...acme,
    body: { name: 'summary', source: summary },
  });
  await server.call('POST', '/v1/orgs/acme/brains/alpha/specs/inference/summary/execute', {
    ...acme,
    body: { input: { text: 'the quarter' }, execution_id: executionId },
  });
});

afterEach(async () => {
  await server.stop();
});

describe('a reasoning function definition of one brain', () => {
  it('is invisible from another brain of the same org', async () => {
    const beta = '/v1/orgs/acme/brains/beta';
    const options = { key: acmeAdmin.key };

    expect(await server.call('GET', `${beta}/specs/inference`, options)).toMatchObject({
      status: 200,
      body: { specs: [] },
    });
    expect(await server.call('GET', `${beta}/specs/inference/summary`, options)).toMatchObject({
      status: 404,
      body: { reason: 'not_found' },
    });
    expect(
      await server.call('POST', `${beta}/specs/inference/summary/execute`, { ...options, body: { input: {} } }),
    ).toMatchObject({ status: 404 });
    expect(await server.call('GET', `${beta}/executions/${executionId}`, options)).toMatchObject({ status: 404 });
  });

  it('is invisible from a brain of the same id in another org, and forbidden to its keys', async () => {
    const globexAlpha = '/v1/orgs/globex/brains/alpha';
    const globex = { key: globexAdmin.key };

    expect(await server.call('GET', `${globexAlpha}/specs/inference`, globex)).toMatchObject({
      status: 200,
      body: { specs: [] },
    });
    expect(await server.call('GET', `${globexAlpha}/executions/${executionId}`, globex)).toMatchObject({
      status: 404,
    });
    expect(await server.call('GET', '/v1/orgs/acme/brains/alpha/specs/inference/summary', globex)).toMatchObject({
      status: 403,
      body: { reason: 'forbidden' },
    });
    expect(server.modelCalls()).toBe(1);
  });
});
