import { issuersOf, type IdentityProvider, type IssuerRequests, type Issuers } from '../index.ts';
import type { Claims, FakeIssuer, Signing } from './fake-issuer.ts';
import { principalIn } from './principals.ts';

export const testPublicUrl = 'https://runtime.example';

export interface SignedTokens {
  readonly issuers: Issuers;
  readonly token: (claims?: Claims, signing?: Signing) => Promise<string>;
  readonly callerOf: (token: string, resourcePath?: string) => Promise<string | undefined>;
}

export function engineersAt(issuer: string): IdentityProvider {
  return {
    name: 'corp',
    issuer,
    org: 'acme',
    grants: { claim: 'groups', by: { engineers: { permissions: ['playbook:read'], playbooks: '*' } } },
  };
}

export async function signedTokens(fake: FakeIssuer, requests: Partial<IssuerRequests> = {}): Promise<SignedTokens> {
  const now = requests.now ?? Date.now;
  const issuers = await issuersOf(
    { providers: [engineersAt(fake.issuer)], publicUrl: testPublicUrl },
    { fetch: fake.answer, now, ...requests },
  );
  return {
    issuers,
    token: (claims = {}, signing = {}) => {
      const seconds = Math.floor(now() / 1000);
      return fake.sign(
        {
          iss: fake.issuer,
          sub: 'ada',
          aud: testPublicUrl,
          iat: seconds,
          exp: seconds + 300,
          groups: ['engineers'],
          ...claims,
        },
        signing,
      );
    },
    callerOf: async (token, resourcePath = '/mcp') =>
      principalIn(await issuers.personOf(token, resourcePath))?.callerIn('acme')?.id,
  };
}
