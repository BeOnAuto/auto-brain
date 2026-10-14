import { identityServiceOf, signInScopes, type IdentityService, type IssuerRequests } from '../index.ts';
import type { Claims, FakeIssuer, Signing } from './fake-issuer.ts';
import { principalIn } from './principals.ts';

export const testPublicUrl = 'https://runtime.example';

export const testAllowedOrigin = 'https://app.example';

export interface SignedTokens {
  readonly identityService: IdentityService;
  readonly token: (claims?: Claims, signing?: Signing) => Promise<string>;
  readonly session: (page: string, claims?: Claims) => Promise<string>;
  readonly callerOf: (token: string, resourcePath?: string, org?: string) => Promise<string | undefined>;
}

export async function signedTokens(fake: FakeIssuer, requests: Partial<IssuerRequests> = {}): Promise<SignedTokens> {
  const now = requests.now ?? Date.now;
  const identityService = await identityServiceOf(
    { issuer: fake.issuer, publicUrl: testPublicUrl, allowedOrigins: [testAllowedOrigin] },
    { fetch: fake.answer, now, ...requests },
  );
  return {
    identityService,
    token: (claims = {}, signing = {}) => {
      const seconds = Math.floor(now() / 1000);
      return fake.sign(
        {
          iss: fake.issuer,
          sub: 'ada',
          aud: testPublicUrl,
          iat: seconds,
          exp: seconds + 300,
          org_id: 'acme',
          scope: signInScopes.join(' '),
          ...claims,
        },
        signing,
      );
    },
    session: (page, claims = {}) => {
      const seconds = Math.floor(now() / 1000);
      return fake.session(page, {
        sub: 'ada',
        org_id: 'acme',
        iat: seconds,
        nbf: seconds,
        exp: seconds + 60,
        ...claims,
      });
    },
    callerOf: async (token, resourcePath = '/mcp', org = 'acme') =>
      principalIn(await identityService.personOf(token, resourcePath))?.callerIn(org)?.id,
  };
}
