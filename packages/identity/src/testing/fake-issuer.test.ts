import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { identityServiceOf } from '../index.ts';
import { fakeIssuer } from './fake-issuer.ts';
import { principalIn } from './principals.ts';

const clients = { 'ada-agent': { secret: 'a-long-secret', claims: { sub: 'ada', org_id: 'acme' } } };

const tokenOf = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }));

function tokenRequest(credentials: string, form: Readonly<Record<string, string>>): Request {
  return new Request('https://login.example/token', {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` },
    body: new URLSearchParams(form),
  });
}

describe('the fake issuer', () => {
  it('mints a token for a client by its credentials, for the resource asked, that the runtime verifies', async () => {
    const fake = fakeIssuer('https://login.example', { clients });
    const identityService = await identityServiceOf(
      { issuer: fake.issuer, publicUrl: 'https://runtime.example' },
      { fetch: fake.answer, now: Date.now },
    );

    const answer = await fake.answer(
      tokenRequest('ada-agent:a-long-secret', {
        grant_type: 'client_credentials',
        resource: 'https://runtime.example',
        scope: 'org:read',
      }),
    );
    const { access_token: token } = tokenOf(await answer.json());

    expect(principalIn(await identityService.personOf(token, '/mcp'))?.callerIn('acme')?.id).toBe('person:ada');
  });
});

describe('the fake issuer refusing', () => {
  it.each([
    ['a wrong secret', 'ada-agent:another-secret', 'client_credentials'],
    ['an unknown client', 'grace-agent:a-long-secret', 'client_credentials'],
    ['another grant', 'ada-agent:a-long-secret', 'password'],
  ])('refuses %s', async (_case, credentials, grant) => {
    const answer = await fakeIssuer('https://login.example', { clients }).answer(
      tokenRequest(credentials, { grant_type: grant }),
    );

    expect([answer.status, await answer.json()]).toEqual([401, { error: 'invalid_client' }]);
  });
});

describe('the fake issuer answering', () => {
  it('mints a token for the issuer itself when no resource is asked', async () => {
    const fake = fakeIssuer('https://login.example', { clients });
    const answer = await fake.answer(tokenRequest('ada-agent:a-long-secret', { grant_type: 'client_credentials' }));
    const { access_token: token } = tokenOf(await answer.json());

    expect(JSON.parse(Buffer.from(String(token.split('.')[1]), 'base64url').toString('utf8'))).toMatchObject({
      aud: 'https://login.example',
      scope: '',
    });
  });

  it('answers 404 on a path it does not serve', async () => {
    expect(
      (await fakeIssuer('https://login.example').answer(new Request('https://login.example/userinfo'))).status,
    ).toBe(404);
  });
});
