import { identityServiceOf, type IdentityService, type IssuerRequests } from '../index.ts';
import type { Claims, FakeIssuer, Signing } from './fake-issuer.ts';
import { principalIn } from './principals.ts';

export const testPublicUrl = 'https://runtime.example';

export interface SignedTokens {
  readonly identityService: IdentityService;
  readonly token: (claims?: Claims, signing?: Signing) => Promise<string>;
  readonly callerOf: (token: string, resourcePath?: string, org?: string) => Promise<string | undefined>;
}

export async function signedTokens(fake: FakeIssuer, requests: Partial<IssuerRequests> = {}): Promise<SignedTokens> {
  const now = requests.now ?? Date.now;
  const identityService = await identityServiceOf(
    { issuer: fake.issuer, publicUrl: testPublicUrl },
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
          ...claims,
        },
        signing,
      );
    },
    callerOf: async (token, resourcePath = '/mcp', org = 'acme') =>
      principalIn(await identityService.personOf(token, resourcePath))?.callerIn(org)?.id,
  };
}
