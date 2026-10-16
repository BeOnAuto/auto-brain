import { signInScopes } from '@on.auto/identity';
import type { FakeIssuer } from '@on.auto/identity/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { accessTokenOf, issuerOverHttps } from '../sign-in/issuer-over-https.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const publicUrl = 'http://localhost:5555';

const connections = '/v1/orgs/acme/connections';

const notes = {
  name: 'notes',
  kind: 'mcp',
  entry: { url: 'https://notes.example.com/mcp' },
  credential: { kind: 'none' },
};

const AddedSchema = Schema.Struct({ id: Schema.String, connect: Schema.Struct({ url: Schema.String }) });

const LinkSchema = Schema.Struct({ token: Schema.String, server: Schema.String });

function linkOf(url: string) {
  return Schema.decodeUnknownSync(LinkSchema)(Object.fromEntries(new URL(url).searchParams));
}

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
});

function tokenOfAnotherPerson(issuer: FakeIssuer): Promise<string> {
  const seconds = Math.floor(Date.now() / 1000);
  return issuer.sign({
    iss: issuer.issuer,
    sub: 'user|grace',
    aud: publicUrl,
    iat: seconds,
    exp: seconds + 300,
    org_id: 'acme',
    scope: signInScopes.join(' '),
  });
}

describe('a connection on a runtime that signs people in', () => {
  it('links to the page with PUBLIC_URL as the server, and is approved by the person who added it alone', async () => {
    const issuer = await issuerOverHttps();
    server = await servingReasoning([], { IDENTITY_ISSUER: issuer.issuer, PUBLIC_URL: publicUrl });
    const ada = await accessTokenOf(issuer, publicUrl, signInScopes.join(' '));
    const grace = await tokenOfAnotherPerson(issuer);

    const answer = await server.call('POST', connections, { key: ada, body: notes });
    const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(answer.body);
    const { token, server: named } = linkOf(connect.url);
    const byGrace = await server.call('POST', `${connections}/${id}/approve`, { key: grace, body: { token } });
    const byAda = await server.call('POST', `${connections}/${id}/approve`, { key: ada, body: { token } });

    expect(answer).toMatchObject({ status: 201, body: { added_by: 'person:user|ada' } });
    expect(named).toBe(publicUrl);
    expect(byGrace).toMatchObject({
      status: 403,
      body: { detail: 'The connection notes was added by another person, and only they may approve it' },
    });
    expect(byAda).toMatchObject({ status: 200, body: { status: 'connected' } });
  });
});
