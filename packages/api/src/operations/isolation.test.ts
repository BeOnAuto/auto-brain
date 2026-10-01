import { authenticatorFor } from '@beonauto/identity';
import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { acmeAdmin, acmeAlphaWriter, acmeReader, globexAdmin, operationServer } from '../testing/operation-server.ts';

function as(key: string): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

const alphaNotes = '/v1/orgs/acme/brains/alpha/notes';

describe('isolation between orgs over HTTP', () => {
  it('refuses a key of one org identically for an existing and a missing brain of another org', async () => {
    const { handler } = await operationServer();

    const existing = await call(handler, '/v1/orgs/globex/brains/gamma/notes', { headers: as(acmeAdmin.key) });
    const missing = await call(handler, '/v1/orgs/globex/brains/nowhere/notes', { headers: as(acmeAdmin.key) });

    expect(existing).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(missing.text).toBe(existing.text);
    expect(await call(handler, '/v1/orgs/globex/brains/gamma/notes', { headers: as(globexAdmin.key) })).toMatchObject({
      status: 200,
    });
  });

  it('refuses a key of one org on an org-scoped operation of another org', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, '/v1/orgs/globex/brain-labels', { headers: as(acmeAdmin.key) })).toMatchObject({
      status: 403,
    });
  });

  it('lets the local developer reach any org', async () => {
    const { handler } = await operationServer({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
    });
    const local = { host: 'localhost:8080' };

    expect(await call(handler, '/v1/orgs/globex/brains/gamma/notes', { headers: local })).toMatchObject({
      status: 200,
    });
    expect(await call(handler, alphaNotes, { headers: local })).toMatchObject({ status: 200 });
  });
});

describe('isolation between brains and permissions over HTTP', () => {
  it('refuses a key limited to one brain on another brain of its own org', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, '/v1/orgs/acme/brains/beta/notes', { headers: as(acmeAlphaWriter.key) })).toMatchObject({
      status: 403,
      body: { reason: 'forbidden' },
    });
    expect(await call(handler, alphaNotes, { headers: as(acmeAlphaWriter.key) })).toMatchObject({ status: 200 });
  });

  it('refuses a key limited to one brain on an org operation that names another brain', async () => {
    const { handler } = await operationServer();
    const labelBeta = { method: 'PUT', headers: as(acmeAlphaWriter.key), body: '{"label":"b"}' };

    expect(await call(handler, '/v1/orgs/acme/brains/beta/label', labelBeta)).toMatchObject({ status: 403 });
  });

  it('refuses a read-only key on a command, and serves it a query', async () => {
    const { handler } = await operationServer();
    const addNote = { method: 'POST', headers: as(acmeReader.key), body: '{"name":"a","text":"b"}' };

    expect(await call(handler, alphaNotes, addNote)).toMatchObject({
      status: 403,
      body: { detail: 'The caller lacks the brain:write permission' },
    });
    expect(await call(handler, alphaNotes, { headers: as(acmeReader.key) })).toMatchObject({ status: 200 });
  });
});
