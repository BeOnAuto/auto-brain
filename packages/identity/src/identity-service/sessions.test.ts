import { allPermissions } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { studioOrigin } from '../index.ts';
import {
  fakeIssuer,
  principalIn,
  signedTokens,
  testAllowedOrigin,
  testPublicUrl,
  type Claims,
} from '../testing/index.ts';

const startedAt = Date.parse('2026-10-13T09:00:00Z');

const seconds = startedAt / 1000;

const atStart = { now: () => startedAt };

const everyPermissionOverEveryPlaybook = { permissions: allPermissions, playbooks: '*' };

const pageRefusal = 'ERR_JWT_CLAIM_VALIDATION_FAILED on its azp claim';

const scopesASessionMayHold: ReadonlyArray<readonly [string, unknown]> = [
  ['a scope that grants one permission', 'user:org:read org:read'],
  ['a scope that is not a string', ['org:read']],
];

describe('a session the identity service gave a page', () => {
  it.each([
    ['the studio', studioOrigin],
    ['an origin of ALLOWED_ORIGINS', testAllowedOrigin],
  ])(
    'from %s is the person of its org_id, with every permission over every playbook, and of no other org',
    async (_case, page) => {
      const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
      const person = principalIn(await identityService.personOf(await session(page, { org_id: 'globex' }), '', page));

      expect(person?.own).toEqual({ id: 'person:ada', org: 'globex', ...everyPermissionOverEveryPlaybook });
      expect(person?.callerIn('acme')).toBeUndefined();
    },
  );

  it.each(scopesASessionMayHold)(
    'gives every permission whatever it holds, %s among it, since a session carries no scopes',
    async (_case, scope) => {
      const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
      const person = principalIn(
        await identityService.personOf(await session(studioOrigin, { scope }), '/mcp', studioOrigin),
      );

      expect(person?.own.permissions).toEqual(allPermissions);
    },
  );

  it('is taken on an MCP endpoint from its page, though it names no audience', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = await identityService.personOf(await session(studioOrigin), '/orgs/acme/mcp', studioOrigin);

    expect(principalIn(person)?.own.id).toBe('person:ada');
  });
});

const presentedByAnotherPage = 'the session was not presented by the page it was issued to';

describe('a session presented by any other than its own page', () => {
  it.each([
    ['without an origin, as an agent presents it', '/mcp', undefined],
    ['without an origin, over HTTP', '', undefined],
    ['from another origin the runtime allows', '', testAllowedOrigin],
    ['from its origin over http', '', 'http://studio.on.auto'],
  ])('is refused %s, naming no value', async (_case, resourcePath, requestOrigin) => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await session(studioOrigin), resourcePath, requestOrigin)).toEqual({
      because: presentedByAnotherPage,
    });
  });

  it('is refused for its azp first when the page it names is not one the runtime allows', async () => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await session('https://elsewhere.example'), '')).toEqual({
      because: pageRefusal,
    });
  });
});

const refusedSessions: ReadonlyArray<readonly [string, string, Claims, string]> = [
  ['another origin', 'https://elsewhere.example', {}, pageRefusal],
  ['the studio over http', 'http://studio.on.auto', {}, pageRefusal],
  ['the studio with a final slash', `${studioOrigin}/`, {}, pageRefusal],
  ['the public URL of the runtime', testPublicUrl, {}, pageRefusal],
  ['an azp that is not a string', studioOrigin, { azp: 7 }, pageRefusal],
  ['no org_id', studioOrigin, { org_id: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its org_id claim'],
  ['the org of local mode', studioOrigin, { org_id: 'local' }, 'its org_id claim is not an org id other than local'],
  ['no sub', studioOrigin, { sub: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its sub claim'],
  [
    'a wrong iss',
    studioOrigin,
    { iss: 'https://elsewhere.example' },
    'ERR_JWT_CLAIM_VALIDATION_FAILED on its iss claim',
  ],
  ['an exp past the leeway', studioOrigin, { exp: seconds - 60 }, 'ERR_JWT_EXPIRED on its exp claim'],
  ['no exp', studioOrigin, { exp: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its exp claim'],
];

describe('a session the runtime refuses, saying why', () => {
  it.each(refusedSessions)('is refused from %s', async (_case, page, claims, because) => {
    const { identityService, session } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await session(page, claims), '', studioOrigin)).toEqual({ because });
  });

  it('is refused when another key signed it', async () => {
    const { identityService } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const other = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await other.session(studioOrigin), '', studioOrigin)).toEqual({
      because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });
});

describe('a token that holds both aud and azp', () => {
  it('is judged as an access token, refused for an audience of another resource whatever page it names', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(
      await identityService.personOf(await token({ aud: 'https://other.example', azp: studioOrigin }), '/mcp'),
    ).toEqual({ because: 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim' });
  });

  it('is judged as an access token, with the permissions among its scopes alone', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const claims = { azp: studioOrigin, scope: 'user:org:read org:read' };

    expect(principalIn(await identityService.personOf(await token(claims), '/mcp'))?.own.permissions).toEqual([
      'org:read',
    ]);
  });

  it('is judged as an access token when its azp names no page the runtime allows', async () => {
    const { callerOf, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({ azp: 'https://elsewhere.example' }))).toBe('person:ada');
  });

  it('is judged as an access token whatever origin presents it, or none', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const accessToken = await token({ azp: studioOrigin });

    expect(
      await Promise.all(
        [undefined, testAllowedOrigin].map(
          async (origin) => principalIn(await identityService.personOf(accessToken, '/mcp', origin))?.own.id,
        ),
      ),
    ).toEqual(['person:ada', 'person:ada']);
  });
});
