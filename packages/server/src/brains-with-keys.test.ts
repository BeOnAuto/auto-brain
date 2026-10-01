import { createApiKey } from '@beonauto/identity';
import { allPermissions } from '@beonauto/operations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from './composition-root.ts';
import { startServer, type RunningServer } from './lifecycle.ts';
import { request } from './testing/http-client.ts';
import { temporaryLedger, type TemporaryLedger } from './testing/temporary-ledger.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' });

const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'brain:read'],
  brains: '*',
});

const acmeAlphaAndDelta = createApiKey({
  id: 'acme-alpha-delta',
  org: 'acme',
  permissions: allPermissions,
  brains: ['alpha', 'delta'],
});

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, brains: '*' });

const apiKeys = JSON.stringify([acmeAdmin.entry, acmeReader.entry, acmeAlphaAndDelta.entry, globexAdmin.entry]);

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName, API_KEYS: apiKeys },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

describe('the brains of an org with API keys', () => {
  it('refuses a key of another org with the same 403 for an existing and a missing brain', async () => {
    await request(server.port, 'POST', '/v1/orgs/globex/brains', {
      key: globexAdmin.key,
      body: { brain: 'gamma', name: 'G' },
    });

    const existing = await request(server.port, 'GET', '/v1/orgs/globex/brains/gamma', { key: acmeAdmin.key });
    const missing = await request(server.port, 'GET', '/v1/orgs/globex/brains/nowhere', { key: acmeAdmin.key });
    const listing = await request(server.port, 'GET', '/v1/orgs/globex/brains', { key: acmeAdmin.key });

    expect(existing).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(missing.text).toBe(existing.text);
    expect(listing.status).toBe(403);
    expect(await request(server.port, 'GET', '/v1/orgs/globex/brains/gamma', { key: globexAdmin.key })).toMatchObject({
      status: 200,
    });
  });
});

describe('the permissions and brains of an API key', () => {
  it('refuse a read-only key on create, and let it list', async () => {
    const creating = await request(server.port, 'POST', '/v1/orgs/acme/brains', {
      key: acmeReader.key,
      body: { brain: 'alpha', name: 'Alpha' },
    });

    expect(creating).toMatchObject({ status: 403, body: { detail: 'The caller lacks the org:write permission' } });
    expect(await request(server.port, 'GET', '/v1/orgs/acme/brains', { key: acmeReader.key })).toMatchObject({
      status: 200,
      body: { brains: [] },
    });
  });

  it('confine a key limited to some brains to those brains, in every operation and in the list', async () => {
    await request(server.port, 'POST', '/v1/orgs/acme/brains', {
      key: acmeAdmin.key,
      body: { brain: 'alpha', name: 'A' },
    });
    await request(server.port, 'POST', '/v1/orgs/acme/brains', {
      key: acmeAdmin.key,
      body: { brain: 'beta', name: 'B' },
    });
    const as = { key: acmeAlphaAndDelta.key };

    const readingBeta = await request(server.port, 'GET', '/v1/orgs/acme/brains/beta', as);
    const creatingEpsilon = await request(server.port, 'POST', '/v1/orgs/acme/brains', {
      ...as,
      body: { brain: 'epsilon', name: 'Epsilon' },
    });
    const creatingDelta = await request(server.port, 'POST', '/v1/orgs/acme/brains', {
      ...as,
      body: { brain: 'delta', name: 'Delta' },
    });
    const listing = await request(server.port, 'GET', '/v1/orgs/acme/brains', as);

    expect([readingBeta.status, creatingEpsilon.status, creatingDelta.status]).toEqual([403, 403, 201]);
    expect(listing.body).toMatchObject({ brains: [{ id: 'alpha' }, { id: 'delta' }] });
  });
});
