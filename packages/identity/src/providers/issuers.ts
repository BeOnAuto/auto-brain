import { Result } from 'effect';
import type { RemoteJWKSet } from 'jose';

import type { Authentication } from '../access/principal.ts';
import { claimedIssuerOf, verifiedPayload, type Payload } from '../tokens/token-verification.ts';
import { admittedPerson } from './admitted-person.ts';
import type { IdentityProvider } from './identity-providers-setting.ts';
import { keysOfIssuer } from './issuer-keys.ts';
import { issuerRequestsOverTheNetwork, type IssuerRequests } from './issuer-requests.ts';
import { UnusableProviderError } from './unusable-provider-error.ts';

export interface ProtectedResource {
  readonly publicUrl: string;
  readonly authorizationServers: readonly string[];
}

export interface Issuers {
  readonly resource: ProtectedResource;
  readonly personOf: (token: string, resourcePath: string) => Promise<Authentication>;
}

export interface SignInSettings {
  readonly providers: readonly IdentityProvider[];
  readonly publicUrl: string;
}

interface TrustedIssuer {
  readonly providers: readonly IdentityProvider[];
  readonly keys: RemoteJWKSet;
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
  return [issuer, { providers: own, keys: read.success }];
}

interface Verified {
  readonly payload: Payload;
  readonly issuer: TrustedIssuer;
}

function audiencesOf(publicUrl: string, resourcePath: string): readonly string[] {
  return [publicUrl, `${publicUrl}/`, ...(resourcePath === '' ? [] : [`${publicUrl}${resourcePath}`])];
}

export async function issuersOf(
  { providers, publicUrl }: SignInSettings,
  requests: IssuerRequests = issuerRequestsOverTheNetwork,
): Promise<Issuers> {
  const names = [...new Set(providers.map(({ issuer }) => issuer))];
  const trusted = new Map(await Promise.all(names.map((issuer) => trustedIssuerOf(issuer, providers, requests))));
  const payloadOf = async (token: string, resourcePath: string): Promise<Result.Result<Verified, string>> => {
    const claimed = claimedIssuerOf(token);
    if (Result.isFailure(claimed)) {
      return Result.fail(claimed.failure);
    }
    const issuer = trusted.get(claimed.success);
    if (issuer === undefined) {
      return Result.fail('its iss names no identity provider');
    }
    const expected = { issuer: claimed.success, audiences: audiencesOf(publicUrl, resourcePath), now: requests.now() };
    return Result.map(await verifiedPayload(token, issuer.keys, expected), (payload) => ({ payload, issuer }));
  };
  return {
    resource: { publicUrl, authorizationServers: names },
    personOf: async (token, resourcePath) => {
      const verified = await payloadOf(token, resourcePath);
      if (Result.isFailure(verified)) {
        return { because: verified.failure };
      }
      const admitted = admittedPerson(verified.success.issuer.providers, verified.success.payload);
      return Result.isSuccess(admitted) ? admitted.success : { because: admitted.failure };
    },
  };
}
