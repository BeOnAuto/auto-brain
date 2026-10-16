import { describe, expect, it } from 'vitest';

import { adding, billing, crm, issuesIn, statusesOf } from '../testing/additions.ts';
import { harness } from '../testing/harness.ts';

const refusedCredentials = [
  ['a kind of credential there is not', { kind: 'consent' }, '/credential/kind'],
  ['a field of another kind', { kind: 'none', name: 'CRM_API_KEY' }, '/credential/name'],
  [
    'a reference without its variable',
    { kind: 'reference', name: 'Authorization', in: 'header' },
    '/credential/variable',
  ],
  [
    'a reference to no variable',
    { kind: 'reference', variable: 'crm-api-key', name: 'Authorization', in: 'header' },
    '/credential/variable',
  ],
  [
    'a reference in no header',
    { kind: 'reference', variable: 'CRM_API_KEY', name: 'a header', in: 'header' },
    '/credential/name',
  ],
  ['a secret that says not where it is sent', { kind: 'secret', name: 'Authorization' }, '/credential/in'],
  ['a secret in a query parameter of an mcp server', { kind: 'secret', name: 'key', in: 'query' }, '/credential/in'],
  ['a secret in a header the entry sends', { kind: 'secret', name: 'x-tenant', in: 'header' }, '/credential/name'],
  ['a secret in no header', { kind: 'secret', name: 'a header', in: 'header' }, '/credential/name'],
  [
    'client credentials without their client',
    { kind: 'client_credentials', issuer: 'https://auth.example.com' },
    '/credential/client_id',
  ],
  [
    'client credentials of an issuer that is not pinned',
    { kind: 'client_credentials', issuer: 'http://auth.example.com', client_id: 'acme' },
    '/credential/issuer',
  ],
] as const;

describe('a credential that cannot be taken', () => {
  it.each(refusedCredentials)('is refused for %s', async (_, credential, pointer) => {
    expect(await adding(harness(), { ...crm, credential })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });

  it('names the field a kind takes and lacks, and the field it does not take', async () => {
    const credentials: readonly Readonly<Record<string, string>>[] = [
      { kind: 'reference', name: 'Authorization', in: 'header' },
      { kind: 'none', in: 'header' },
      { kind: 'client_credentials', issuer: 'https://auth.example.com', client_id: 'acme', name: 'CRM_API_KEY' },
    ];

    const refused = await Promise.all(
      credentials.map(async (credential) => issuesIn(await adding(harness(), { ...crm, credential }))),
    );

    expect(refused).toEqual([
      [{ pointer: '/credential/variable', detail: 'Expected variable, which a reference credential takes' }],
      [{ pointer: '/credential/in', detail: 'Expected no in: a none credential takes no other field' }],
      [
        {
          pointer: '/credential/name',
          detail: 'Expected no name: a client_credentials credential takes issuer, client_id, and scope',
        },
      ],
    ]);
  });
});

function inHeader(name: string) {
  return { kind: 'secret', name, in: 'header' } as const;
}

describe('a secret in a header', () => {
  it('is refused in a header the runtime sends itself, and taken in Authorization', async () => {
    const connections: readonly unknown[] = [
      { ...crm, credential: inHeader('Mcp-Session-Id') },
      { ...crm, credential: inHeader('Host') },
      { ...billing, credential: inHeader('Content-Type') },
      { ...billing, credential: inHeader('content-length') },
    ];

    const refused = await Promise.all(
      connections.map(async (connection: unknown) => issuesIn(await adding(harness(), connection))),
    );
    const statuses = await statusesOf(harness(), [
      { ...crm, credential: inHeader('Authorization') },
      { ...billing, credential: inHeader('Authorization') },
    ]);

    expect(refused).toEqual([
      [
        {
          pointer: '/credential/name',
          detail: 'A header the MCP client sets itself, so the credential cannot go in it',
        },
      ],
      [
        {
          pointer: '/credential/name',
          detail: 'A header the MCP client sets itself, so the credential cannot go in it',
        },
      ],
      [{ pointer: '/credential/name', detail: 'A header the runtime sets itself, so the credential cannot go in it' }],
      [{ pointer: '/credential/name', detail: 'A header the runtime sets itself, so the credential cannot go in it' }],
    ]);
    expect(statuses).toEqual(['succeeded', 'succeeded']);
  });
});

describe('a secret of an HTTP API', () => {
  it('is taken in a header, a query parameter or a security scheme the entry leaves free', async () => {
    const api = { ...billing, entry: { ...billing.entry, query_params: { tenant: 'acme' } } };
    const sentAs = (name: string, credential: Readonly<Record<string, string>>) => ({
      ...api,
      name,
      credential: { kind: 'secret', ...credential },
    });

    const statuses = await statusesOf(harness(), [
      sentAs('billing-header', { name: 'X-Api-Key', in: 'header' }),
      sentAs('billing-key', { name: 'key', in: 'query' }),
      sentAs('billing-scheme', { name: 'apiKey', in: 'security' }),
      sentAs('billing-tenant', { name: 'Tenant', in: 'query' }),
    ]);

    expect(statuses).toEqual(['succeeded', 'succeeded', 'succeeded', 'rejected']);
  });
});
