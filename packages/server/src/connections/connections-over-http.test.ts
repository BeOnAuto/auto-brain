import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { keptValueOf, secretIdOf, secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

const crm = {
  name: 'crm',
  kind: 'mcp',
  entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' } },
  credential: { kind: 'secret', placed: { header: 'Authorization' } },
};

const AddedSchema = Schema.Struct({
  id: Schema.String,
  connect: Schema.Struct({ url: Schema.String, expires_at: Schema.String }),
});

let server: ReasoningServer | undefined;
let ledger: TemporaryLedger | undefined;

afterEach(async () => {
  await server?.stop();
  ledger?.remove();
});

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  ledger = temporaryLedger();
  server = await servingReasoning([], {
    LEDGER_FILE: ledger.fileName,
    SECRETS_KEY: secretsKey.toString('base64'),
    ...environment,
  });
  return server;
}

async function added(served: ReasoningServer, body: unknown = crm) {
  const answer = await served.call('POST', connections, { body });
  const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answer.body);
  const page = new URL(connect.url);
  const { token } = Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String }))(
    Object.fromEntries(page.searchParams),
  );
  return { answer, id, page, token };
}

describe('adding a connection over HTTP in local mode', () => {
  it("answers 201 with the record and a link to Studio's page that names the server's own address", async () => {
    const served = await serving();

    const { answer, id, page } = await added(served);

    expect(answer).toMatchObject({ status: 201, body: { id, name: 'crm', status: 'pending', added_by: 'local' } });
    expect(Object.fromEntries(page.searchParams)).toMatchObject({
      server: served.origin,
      org: 'local',
      connection: id,
    });
    expect(`${page.origin}${page.pathname}`).toBe('https://studio.on.auto/connect');
  });

  it('lists the connection and reads it, and reads it through its link', async () => {
    const served = await serving();
    const { id, token } = await added(served);

    const [listed, read, linked] = [
      await served.call('GET', connections),
      await served.call('GET', `${connections}/${id}`),
      await served.call('GET', `${connections}/${id}/link/${token}`),
    ];

    expect(listed).toMatchObject({ status: 200, body: { connections: [{ id, name: 'crm' }] } });
    expect([read.body, linked.body]).toMatchObject([{ id }, { id, status: 'pending' }]);
    expect((await served.call('GET', `${connections}/${id}/link/unknown`)).status).toBe(404);
  });
});

describe('giving the credential of a connection over HTTP', () => {
  it('connects it, keeps exactly the value sealed in the secret store, uses the link up, and forgets it on removal', async () => {
    const served = await serving();
    const { id, token } = await added(served);
    const fileName = String(ledger?.fileName);

    const approval = await served.call('POST', `${connections}/${id}/approve`, { body: { token } });
    const given = await served.call('POST', `${connections}/${id}/credential`, {
      body: { token, value: 'Bearer crm-0f3c' },
    });
    const secretId = String(await secretIdOf(fileName, 'local', id));
    const keptBefore = await keptValueOf(fileName, secretId);
    const again = await served.call('POST', `${connections}/${id}/credential`, { body: { token, value: 'x' } });
    const removed = await served.call('DELETE', `${connections}/${id}`);

    expect(approval).toMatchObject({ status: 409, body: { reason: 'conflict' } });
    expect(given).toMatchObject({ status: 200, body: { id, status: 'connected' } });
    expect(keptBefore).toBe('Bearer crm-0f3c');
    expect(again.status).toBe(404);
    expect(removed).toMatchObject({ status: 200, body: { status: 'removed' } });
    expect(await keptValueOf(fileName, secretId)).toBeUndefined();
  });

  it('approves one that takes no credential to give', async () => {
    const served = await serving();
    const { id, token } = await added(served, { ...crm, credential: { kind: 'none' } });

    expect(await served.call('POST', `${connections}/${id}/approve`, { body: { token } })).toMatchObject({
      status: 200,
      body: { status: 'connected' },
    });
  });
});

describe('the rules of the runtime over HTTP', () => {
  it('answers 403 with the sentence of a rule the policy holds, and 409 for the name of an entry of the configuration', async () => {
    const served = await serving({
      CONNECTIONS: JSON.stringify({ credential_kinds: ['none'] }),
      TOOL_SERVERS: JSON.stringify({ wiki: { url: 'http://127.0.0.1:9/mcp', org: 'local' } }),
    });

    const refused = await served.call('POST', connections, { body: crm });
    const taken = await served.call('POST', connections, {
      body: { ...crm, name: 'wiki', credential: { kind: 'none' } },
    });

    expect(refused).toMatchObject({
      status: 403,
      body: {
        detail: 'A connection may not take a secret credential on this runtime, which allows none',
      },
    });
    expect(taken).toMatchObject({ status: 409, body: { kind: 'taken' } });
  });
});
