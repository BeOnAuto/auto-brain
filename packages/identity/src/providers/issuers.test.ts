import { describe, expect, it } from 'vitest';

import { issuersOf, type IssuerFetch } from '../index.ts';
import {
  engineersAt,
  fakeIssuer,
  signedTokens,
  testPublicUrl,
  type Claims,
  type FakeIssuer,
  type FakeSigner,
} from '../testing/index.ts';

const startedAt = Date.parse('2026-10-13T09:00:00Z');

const seconds = startedAt / 1000;

const atStart = { now: () => startedAt };

const signers: readonly FakeSigner[] = ['RS256', 'PS256', 'ES256', 'EdDSA'];

function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function routedTo(fakes: readonly FakeIssuer[]): IssuerFetch {
  const byHost = new Map(fakes.map((fake) => [new URL(fake.issuer).host, fake]));
  return (request) =>
    byHost.get(new URL(request.url).host)?.answer(request) ?? Promise.resolve(new Response(null, { status: 404 }));
}

describe('a token signed by a configured issuer', () => {
  it.each(signers)('is verified when signed with %s', async (signer) => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({}, { signer }))).toBe('person:corp/ada');
  });

  it.each(signers)('is refused when signed with %s by another key under the same kid', async (signer) => {
    const { issuers } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const other = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await issuers.personOf(await other.token({}, { signer }), '/mcp')).toEqual({
      because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });

  it.each([['at+jwt'], ['application/at+jwt'], ['JWT'], ['application/jwt'], [null]])(
    'is verified with the typ %s',
    async (typ) => {
      const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

      expect(await callerOf(await token({}, { typ }))).toBe('person:corp/ada');
    },
  );

  it.each([
    ['the public URL', testPublicUrl, ''],
    ['the public URL with a slash', `${testPublicUrl}/`, '/mcp'],
    ['the public URL and the endpoint the request reached', `${testPublicUrl}/orgs/acme/mcp`, '/orgs/acme/mcp'],
    ['a list that holds the public URL', ['https://other.example', testPublicUrl], '/mcp'],
  ])('is verified for an audience of %s', async (_case, aud: string | readonly string[], resourcePath) => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({ aud }), resourcePath)).toBe('person:corp/ada');
  });

  it('is verified within the 60 seconds of leeway around its times', async () => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({ exp: seconds - 59, nbf: seconds + 59, iat: seconds + 59 }))).toBe(
      'person:corp/ada',
    );
  });
});

const refusedClaims: ReadonlyArray<readonly [string, Claims, string]> = [
  ['a wrong iss', { iss: 'https://elsewhere.example' }, 'its iss names no identity provider'],
  ['no iss', { iss: undefined }, 'it names no iss'],
  ['no aud', { aud: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim'],
  ['an aud of another resource', { aud: 'https://other.example' }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim'],
  [
    'an aud of another endpoint',
    { aud: `${testPublicUrl}/orgs/globex/mcp` },
    'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim',
  ],
  ['an exp past the leeway', { exp: seconds - 60 }, 'ERR_JWT_EXPIRED on its exp claim'],
  ['no exp', { exp: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its exp claim'],
  ['an nbf beyond the leeway', { nbf: seconds + 61 }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its nbf claim'],
  ['an iat beyond the leeway', { iat: seconds + 61 }, 'its iat is more than 60 seconds ahead'],
  ['no sub', { sub: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its sub claim'],
  ['an empty sub', { sub: '' }, 'its sub is not a non-empty string of at most 256 bytes'],
  ['a sub that is not a string', { sub: 7 }, 'its sub is not a non-empty string of at most 256 bytes'],
  ['a sub over 256 bytes', { sub: 'ü'.repeat(129) }, 'its sub is not a non-empty string of at most 256 bytes'],
];

describe('a token the runtime refuses, saying why', () => {
  it.each(refusedClaims)('is refused for %s', async (_case, claims, because) => {
    const { issuers, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await issuers.personOf(await token(claims), '/mcp')).toEqual({ because });
  });
});

describe('a token the runtime refuses for its form, saying why', () => {
  it('is refused for the typ of another kind of token', async () => {
    const { issuers, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await issuers.personOf(await token({}, { typ: 'id_token+jwt' }), '/mcp')).toEqual({
      because: 'its typ is not that of an access token',
    });
  });

  it('is refused for the path form of its audience on a path that is no endpoint', async () => {
    const { issuers, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await issuers.personOf(await token({ aud: `${testPublicUrl}/orgs/acme/mcp` }), '')).toEqual({
      because: 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim',
    });
  });

  it('is refused for the algorithm none, and for a payload changed after it was signed', async () => {
    const { issuers, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const [header = '', payload = '', signature = ''] = (await token()).split('.');
    const claims = { iss: 'https://login.example', sub: 'ada', aud: testPublicUrl, exp: seconds + 300 };

    expect([
      await issuers.personOf(`${segmentOf({ alg: 'none', kid: 'rs256-1' })}.${payload}.`, '/mcp'),
      await issuers.personOf(
        `${header}.${segmentOf({ ...claims, groups: ['engineers', 'admins'] })}.${signature}`,
        '/mcp',
      ),
    ]).toEqual([{ because: 'ERR_JOSE_ALG_NOT_ALLOWED' }, { because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }]);
  });

  it.each([
    ['an opaque token', 'an-opaque-token-of-the-provider'],
    ['a token of two segments', `${segmentOf({ alg: 'RS256' })}.${segmentOf({ sub: 'ada' })}`],
  ])('is refused for %s', async (_case, presented) => {
    const { issuers } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await issuers.personOf(presented, '/mcp')).toEqual({ because: 'ERR_JWT_INVALID' });
  });
});

describe('a token the runtime refuses for its key or its subject, saying why', () => {
  it('is refused when the claim an entry names its subject by holds more than 256 bytes', async () => {
    const fake = fakeIssuer('https://login.example');
    const issuers = await issuersOf(
      { providers: [{ ...engineersAt(fake.issuer), subject: 'oid' }], publicUrl: testPublicUrl },
      { fetch: fake.answer, ...atStart },
    );
    const claims = { iss: fake.issuer, sub: 'ada', aud: testPublicUrl, exp: seconds + 300, oid: 'ü'.repeat(129) };

    expect(await issuers.personOf(await fake.sign(claims), '/mcp')).toEqual({
      because: 'its claim oid holds a subject of more than 256 bytes',
    });
  });

  it('is refused when another issuer signed it under a kid both issuers use', async () => {
    const own = fakeIssuer('https://login.example');
    const other = fakeIssuer('https://other.example');
    const issuers = await issuersOf(
      {
        providers: [engineersAt(own.issuer), { ...engineersAt(other.issuer), name: 'other' }],
        publicUrl: testPublicUrl,
      },
      { fetch: routedTo([own, other]), ...atStart },
    );
    const claims = { iss: own.issuer, sub: 'ada', aud: testPublicUrl, exp: seconds + 300, groups: ['engineers'] };

    expect(await issuers.personOf(await other.sign(claims), '/mcp')).toEqual({
      because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });
});

describe('the issuers of the protected resource', () => {
  it('are the configured issuers, each once, with the public URL', async () => {
    const login = fakeIssuer('https://login.example');
    const other = fakeIssuer('https://other.example/tenant');
    const issuers = await issuersOf(
      {
        providers: [
          engineersAt(login.issuer),
          { ...engineersAt(login.issuer), org: 'globex' },
          { ...engineersAt(other.issuer), name: 'other' },
        ],
        publicUrl: testPublicUrl,
      },
      { fetch: routedTo([login, other]), ...atStart },
    );

    expect(issuers.resource).toEqual({
      publicUrl: testPublicUrl,
      authorizationServers: ['https://login.example', 'https://other.example/tenant'],
    });
  });

  it('stop the server at start, naming the provider, when an issuer cannot be read', async () => {
    const fake = fakeIssuer('https://login.example');

    await expect(
      issuersOf(
        { providers: [engineersAt(fake.issuer)], publicUrl: testPublicUrl },
        { fetch: () => Promise.resolve(new Response('', { status: 404 })), now: Date.now },
      ),
    ).rejects.toMatchObject({
      name: 'UnusableProviderError',
      message:
        'The identity provider corp cannot be used: no metadata of https://login.example could be used: https://login.example/.well-known/oauth-authorization-server answers 404; https://login.example/.well-known/openid-configuration answers 404',
    });
  });
});
