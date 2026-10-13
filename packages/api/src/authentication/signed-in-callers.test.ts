import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { acmeAdmin } from '../testing/operation-server.ts';
import { publicUrl, signedInServer } from '../testing/signed-in.ts';

const rootMetadata = `${publicUrl}/.well-known/oauth-protected-resource`;

const everyScope = 'org:read org:write playbook:read playbook:write';

const onTheCurrentRevision = { 'mcp-protocol-version': '2025-11-25' };

describe('a signed-in person over HTTP', () => {
  it('is admitted to each org an entry admits them to, with the grants of that entry', async () => {
    const { server, bearer } = await signedInServer();

    expect([
      (await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', { headers: await bearer() })).status,
      (await call(server.handler, '/v1/orgs/globex/playbooks/gamma/notes', { headers: await bearer() })).status,
    ]).toEqual([200, 200]);
  });

  it('is refused a third org with 403, naming the scope of the operation and the metadata', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/initech/playbook-labels', { headers: await bearer() });

    expect(answer).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'The caller does not belong to this org' },
    });
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="org:read", resource_metadata="${rootMetadata}"`,
    );
  });

  it('is refused what their grants do not allow with the scope the operation needs', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
      method: 'POST',
      headers: { ...(await bearer({ groups: ['readers'] })), 'content-type': 'application/json' },
      body: '{"name":"a","text":"b"}',
    });

    expect(answer).toMatchObject({ status: 403, body: { detail: 'The caller lacks the playbook:write permission' } });
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="playbook:write", resource_metadata="${rootMetadata}"`,
    );
  });
});

describe('a signed-in person whose grants fall short', () => {
  it('is authenticated and forbidden everywhere when their claims grant nothing', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
      headers: await bearer({ groups: ['visitors'] }),
    });

    expect(answer).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  });

  it('sits beside the keys, which are verified as keys', async () => {
    const { server } = await signedInServer();

    expect(
      await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
        headers: { authorization: `Bearer ${acmeAdmin.key}` },
      }),
    ).toMatchObject({ status: 200 });
  });
});

describe('a signed-in person over MCP', () => {
  it('is refused an org no entry admits them to with 403, naming every scope and the endpoint’s metadata', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await postMcp(server.handler, '/orgs/initech/mcp', await bearer());

    expect(answer.status).toBe(403);
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="${everyScope}", resource_metadata="${rootMetadata}/orgs/initech/mcp"`,
    );
  });

  it('is refused a playbook outside their grants on a playbook endpoint', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await postMcp(
      server.handler,
      '/orgs/acme/playbooks/beta/mcp',
      await bearer({ groups: ['readers'] }),
    );

    expect(answer.status).toBe(403);
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="${everyScope}", resource_metadata="${rootMetadata}/orgs/acme/playbooks/beta/mcp"`,
    );
  });
});

describe('the own org of a signed-in person over MCP', () => {
  it('is served on /mcp in the org of the first entry that admits them', async () => {
    const { server, bearer } = await signedInServer();

    const labelled = await postMcp(
      server.handler,
      '/mcp',
      { ...(await bearer()), ...onTheCurrentRevision },
      requestOf(1, 'tools/call', { name: 'label_playbook', arguments: { playbook: 'alpha', label: 'signed-in' } }),
    );
    const labels = await call(server.handler, '/v1/orgs/acme/playbook-labels', { headers: await bearer() });

    expect(messagesIn(labelled)).toMatchObject([
      { result: { structuredContent: { playbook: 'alpha', label: 'signed-in' } } },
    ]);
    expect(labels.body).toEqual({ labels: [{ playbook: 'alpha', label: 'signed-in' }] });
  });

  it('is refused /mcp with 403 when no entry admits them', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await postMcp(server.handler, '/mcp', await bearer({ groups: ['visitors'] }));

    expect([answer.status, JSON.parse(answer.text)]).toMatchObject([403, { detail: 'The caller belongs to no org' }]);
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="${everyScope}", resource_metadata="${rootMetadata}/mcp"`,
    );
  });
});

describe('a request without a valid token, with a provider configured', () => {
  it('is answered 401 with the metadata and every scope, and no error when nothing was presented', async () => {
    const { server } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes');

    expect(answer).toMatchObject({
      status: 401,
      body: { reason: 'unauthenticated', detail: 'A valid API key or access token is required' },
    });
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${rootMetadata}", scope="${everyScope}"`,
    );
  });
});

describe('a token the runtime refuses, with a provider configured', () => {
  it('is answered 401 with invalid_token for an opaque token', async () => {
    const { server } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
      headers: { authorization: 'Bearer an-opaque-token' },
    });

    expect(answer).toMatchObject({
      status: 401,
      body: { reason: 'unauthenticated', detail: 'The access token was refused: ERR_JWT_INVALID' },
    });
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", resource_metadata="${rootMetadata}", scope="${everyScope}"`,
    );
  });

  it.each([
    ['no sub', { sub: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its sub claim'],
    ['an empty sub', { sub: '' }, 'its sub is not a non-empty string of at most 256 bytes'],
    ['an expired one', { exp: 1 }, 'ERR_JWT_EXPIRED on its exp claim'],
  ])(
    'says why it refused a token with %s, naming no value of it',
    async (_case, claims: Readonly<Record<string, unknown>>, words) => {
      const { server, bearer } = await signedInServer();

      const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
        headers: await bearer(claims),
      });

      expect(answer).toMatchObject({ status: 401, body: { detail: `The access token was refused: ${words}` } });
    },
  );
});

describe('the audience of a token, with a provider configured', () => {
  it('is answered 401 for a token whose audience is another endpoint', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
      headers: await bearer({ aud: `${publicUrl}/orgs/acme/mcp` }),
    });

    expect(answer.status).toBe(401);
  });

  it('takes a token for the endpoint it reached', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await postMcp(server.handler, '/orgs/acme/mcp', await bearer({ aud: `${publicUrl}/orgs/acme/mcp` }));

    expect(answer.status).toBe(200);
  });
});
