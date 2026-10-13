import { Result } from 'effect';

import type { Principal } from '../access/principal.ts';
import { accessTokenOf, type AccessToken } from '../tokens/access-token.ts';
import { isIntendedFor, isTimely } from '../tokens/token-claims.ts';
import { admittedPerson } from './admitted-person.ts';
import type { IdentityProvider } from './identity-providers-setting.ts';
import { issuerRequestsOverTheNetwork, type IssuerRequests } from './issuer-requests.ts';
import { keysOfIssuer, type IssuerKeys } from './key-set.ts';
import { UnusableProviderError } from './unusable-provider-error.ts';

export interface ProtectedResource {
  readonly publicUrl: string;
  readonly authorizationServers: readonly string[];
}

export interface Issuers {
  readonly resource: ProtectedResource;
  readonly personOf: (token: string, path: string) => Promise<Principal | undefined>;
}

export interface SignInSettings {
  readonly providers: readonly IdentityProvider[];
  readonly publicUrl: string;
}

interface TrustedIssuer extends IssuerKeys {
  readonly providers: readonly IdentityProvider[];
}

async function trustedIssuerOf(
  issuer: string,
  providers: readonly IdentityProvider[],
  requests: IssuerRequests,
): Promise<readonly [string, TrustedIssuer]> {
  const own = providers.filter((provider) => provider.issuer === issuer);
  const read = await keysOfIssuer(issuer, requests);
  if (Result.isFailure(read)) {
    const name = [...new Set(own.map((provider) => provider.name))].join(', ');
    throw new UnusableProviderError({ message: `The identity provider ${name} cannot be used: ${read.failure}` });
  }
  return [issuer, { providers: own, ...read.success }];
}

interface Presented {
  readonly token: AccessToken;
  readonly issuer: TrustedIssuer;
}

export async function issuersOf(
  { providers, publicUrl }: SignInSettings,
  requests: IssuerRequests = issuerRequestsOverTheNetwork,
): Promise<Issuers> {
  const names = [...new Set(providers.map(({ issuer }) => issuer))];
  const trusted = new Map(await Promise.all(names.map((issuer) => trustedIssuerOf(issuer, providers, requests))));
  const presentedOf = (text: string, path: string): Presented | undefined => {
    const token = accessTokenOf(text);
    const issuer = token === undefined ? undefined : trusted.get(token.claims.iss);
    return token !== undefined &&
      issuer?.algorithms.includes(token.algorithm) === true &&
      isTimely(token.claims, requests.now()) &&
      isIntendedFor(token.claims, publicUrl, path)
      ? { token, issuer }
      : undefined;
  };
  return {
    resource: { publicUrl, authorizationServers: names },
    personOf: async (text, path) => {
      const presented = presentedOf(text, path);
      const key = await presented?.issuer.keys.keyFor(presented.token.keyId);
      return presented !== undefined &&
        key?.verifies(presented.token.algorithm, presented.token.signed, presented.token.signature) === true
        ? admittedPerson(presented.issuer.providers, presented.token.payload)
        : undefined;
    },
  };
}
