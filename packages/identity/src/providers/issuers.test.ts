import { describe, expect, it } from 'vitest';

import { issuersOf, type IdentityProvider, type IssuerFetch, type IssuerRequests, type Issuers } from '../index.ts';
import { fakeIssuer, type Claims, type FakeIssuer, type FakeSigner, type Signing } from '../testing/index.ts';

const publicUrl = 'https://runtime.example';

const startedAt = Date.parse('2026-10-13T09:00:00Z');

const seconds = startedAt / 1000;

function corpAt(issuer: string): IdentityProvider {
  return {
    name: 'corp',
    issuer,
    org: 'acme',
    grants: { claim: 'groups', by: { engineers: { permissions: ['playbook:read'], playbooks: '*' } } },
  };
}

interface Signed {
  readonly fake: FakeIssuer;
  readonly issuers: Issuers;
  readonly token: (claims?: Claims, signing?: Signing) => string;
}

async function signedBy(fake: FakeIssuer, requests: Partial<IssuerRequests> = {}): Promise<Signed> {
  const issuers = await issuersOf(
    { providers: [corpAt(fake.issuer)], publicUrl },
    { fetch: fake.answer, now: () => startedAt, ...requests },
  );
  const token = (claims: Claims = {}, signing: Signing = {}): string =>
    fake.sign(
      {
        iss: fake.issuer,
        sub: 'ada',
        aud: publicUrl,
        iat: seconds,
        exp: seconds + 300,
        groups: ['engineers'],
        ...claims,
      },
      signing,
    );
  return { fake, issuers, token };
}

async function callerOf(issuers: Issuers, token: string, path = '/mcp'): Promise<string | undefined> {
  return (await issuers.personOf(token, path))?.callerIn('acme')?.id;
}

interface Unreachable {
  readonly fetch: IssuerFetch;
  readonly cut: () => void;
}

function cutAfterStart(fake: FakeIssuer): Unreachable {
  let reachable = true;
  return {
    fetch: (request) => (reachable ? fake.answer(request) : Promise.reject(new TypeError('fetch failed'))),
    cut: () => {
      reachable = false;
    },
  };
}

function routedTo(fakes: readonly FakeIssuer[]): IssuerFetch {
  const byHost = new Map(fakes.map((fake) => [new URL(fake.issuer).host, fake]));
  return (request) =>
    byHost.get(new URL(request.url).host)?.answer(request) ?? Promise.reject(new TypeError('fetch failed'));
}

const signers: readonly FakeSigner[] = ['RS256', 'PS256', 'ES256', 'Ed25519', 'Ed448'];

describe('a token signed by a configured issuer', () => {
  it.each(signers)('is verified when signed with %s', async (signer) => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));

    expect(await callerOf(issuers, token({}, { signer }))).toBe('person:corp/ada');
  });

  it.each([['at+jwt'], ['application/at+jwt'], ['JWT'], [undefined]])('is verified with the typ %s', async (typ) => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));

    expect(await callerOf(issuers, token({}, { header: { typ } }))).toBe('person:corp/ada');
  });

  it.each([
    ['the public URL', publicUrl, '/v1/orgs/acme/playbooks'],
    ['the public URL with a slash', `${publicUrl}/`, '/mcp'],
    ['the public URL and the path the request reached', `${publicUrl}/orgs/acme/mcp`, '/orgs/acme/mcp'],
    ['a list that holds the public URL', ['https://other.example', publicUrl], '/mcp'],
  ])('is verified for an audience of %s', async (_case, aud: string | readonly string[], path) => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));

    expect(await callerOf(issuers, token({ aud }), path)).toBe('person:corp/ada');
  });

  it('is verified within the 60 seconds of leeway around its times', async () => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));

    expect(await callerOf(issuers, token({ exp: seconds - 59, nbf: seconds + 59, iat: seconds + 59 }))).toBe(
      'person:corp/ada',
    );
  });
});

const refusedClaims: ReadonlyArray<readonly [string, Claims]> = [
  ['a wrong iss', { iss: 'https://elsewhere.example' }],
  ['no aud', { aud: undefined }],
  ['an aud of another resource', { aud: 'https://other.example' }],
  ['an aud of another path', { aud: `${publicUrl}/orgs/globex/mcp` }],
  ['an exp past the leeway', { exp: seconds - 60 }],
  ['no exp', { exp: undefined }],
  ['an nbf beyond the leeway', { nbf: seconds + 61 }],
  ['an iat beyond the leeway', { iat: seconds + 61 }],
];

const refusedHeaders: ReadonlyArray<readonly [string, Claims]> = [
  ['the algorithm none', { alg: 'none' }],
  ['an algorithm the runtime does not verify', { alg: 'HS256' }],
  ['the algorithm of another key', { alg: 'ES256' }],
  ['no kid', { kid: undefined }],
  ['the typ of an identity token of another kind', { typ: 'id_token+jwt' }],
  ['a critical extension', { crit: ['exp'] }],
];

describe('a token the runtime refuses', () => {
  it.each(refusedClaims)('is refused for %s', async (_case, claims) => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));

    expect(await issuers.personOf(token(claims), '/mcp')).toBeUndefined();
  });

  it.each(refusedHeaders)('is refused for %s in its header', async (_case, header) => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));

    expect(await issuers.personOf(token({}, { header }), '/mcp')).toBeUndefined();
  });

  it('is refused when its signature is not the issuer key’s', async () => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));
    const [header, payload] = token().split('.');
    const forged = fakeIssuer('https://login.example').sign({}).split('.')[2];

    expect(await issuers.personOf(`${String(header)}.${String(payload)}.${String(forged)}`, '/mcp')).toBeUndefined();
  });

  it.each([
    ['an opaque token', 'an-opaque-token-of-the-provider'],
    ['a token of two segments', 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZGEifQ'],
    ['a token of four segments', 'a.b.c.d'],
    ['a token without a signature', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZGEifQ.'],
    ['a header that is not UTF-8', `${Buffer.from([0xff, 0xfe]).toString('base64url')}.e30.c2ln`],
    ['a header that is not JSON', `${Buffer.from('not json').toString('base64url')}.e30.c2ln`],
  ])('is refused for %s', async (_case, presented) => {
    const { issuers } = await signedBy(fakeIssuer('https://login.example'));

    expect(await issuers.personOf(presented, '/mcp')).toBeUndefined();
  });

  it('is refused when its claims are not a JSON object', async () => {
    const { issuers, token } = await signedBy(fakeIssuer('https://login.example'));
    const [header] = token().split('.');

    expect(await issuers.personOf(`${String(header)}.${Buffer.from('[]').toString('base64url')}.c2ln`, '/mcp')).toBe(
      undefined,
    );
  });
});

describe('the algorithms of an issuer', () => {
  it('are those its metadata lists, when it lists any', async () => {
    const fake = fakeIssuer('https://login.example', {
      metadata: { id_token_signing_alg_values_supported: ['RS256', 'HS256'] },
    });
    const { issuers, token } = await signedBy(fake);

    expect([await callerOf(issuers, token()), await callerOf(issuers, token({}, { signer: 'ES256' }))]).toEqual([
      'person:corp/ada',
      undefined,
    ]);
  });
});

describe('the key of a token', () => {
  it('is fetched again for an unknown kid, so a rotated key verifies, and at most once a minute', async () => {
    let now = startedAt;
    const fake = fakeIssuer('https://login.example');
    const { issuers, token } = await signedBy(fake, { now: () => now });
    now += 60_000;
    fake.rotate();
    const rotated = token();

    expect(await callerOf(issuers, rotated)).toBe('person:corp/ada');
    expect(await issuers.personOf(token({}, { header: { kid: 'unknown' } }), '/mcp')).toBeUndefined();
    expect(fake.keySetReads()).toBe(2);
  });

  it('refuses an unknown kid after one fetch again, and fetches no more within the minute', async () => {
    let now = startedAt;
    const fake = fakeIssuer('https://login.example');
    const { issuers, token } = await signedBy(fake, { now: () => now });
    now += 60_000;
    const unknown = token({}, { header: { kid: 'unknown' } });

    expect(await Promise.all([issuers.personOf(unknown, '/mcp'), issuers.personOf(unknown, '/mcp')])).toEqual([
      undefined,
      undefined,
    ]);
    now += 59_999;
    expect(await issuers.personOf(unknown, '/mcp')).toBeUndefined();
    expect(fake.keySetReads()).toBe(2);
  });

  it('keeps the keys it holds when fetching them again fails', async () => {
    let now = startedAt;
    const fake = fakeIssuer('https://login.example');
    const network = cutAfterStart(fake);
    const { issuers, token } = await signedBy(fake, { now: () => now, fetch: network.fetch });
    network.cut();
    now += 60_000;

    expect(await issuers.personOf(token({}, { header: { kid: 'unknown' } }), '/mcp')).toBeUndefined();
    expect(await callerOf(issuers, token())).toBe('person:corp/ada');
  });
});

describe('the issuers of the protected resource', () => {
  it('are the configured issuers, each once, with the public URL', async () => {
    const login = fakeIssuer('https://login.example');
    const other = fakeIssuer('https://other.example/tenant');
    const issuers = await issuersOf(
      {
        providers: [
          corpAt(login.issuer),
          { ...corpAt(login.issuer), org: 'globex' },
          { ...corpAt(other.issuer), name: 'other' },
        ],
        publicUrl,
      },
      { fetch: routedTo([login, other]), now: () => startedAt },
    );

    expect(issuers.resource).toEqual({
      publicUrl,
      authorizationServers: ['https://login.example', 'https://other.example/tenant'],
    });
  });

  it('stop the server at start, naming the provider, when an issuer cannot be read', async () => {
    const fake = fakeIssuer('https://login.example');

    await expect(
      issuersOf(
        { providers: [corpAt(fake.issuer)], publicUrl },
        { fetch: () => Promise.resolve(new Response('', { status: 404 })), now: Date.now },
      ),
    ).rejects.toMatchObject({
      name: 'UnusableProviderError',
      message:
        'The identity provider corp cannot be used: no metadata of https://login.example could be used: https://login.example/.well-known/oauth-authorization-server answers 404; https://login.example/.well-known/openid-configuration answers 404',
    });
  });
});
