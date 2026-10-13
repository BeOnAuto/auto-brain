import { Result } from 'effect';

import { signedInPersonOf, type Authentication } from '../access/principal.ts';
import { verifiedPerson } from '../tokens/token-verification.ts';
import { keysOfIssuer } from './issuer-keys.ts';
import { issuerRequestsOverTheNetwork, type IssuerRequests } from './issuer-requests.ts';
import { UnusableIdentityServiceError } from './unusable-identity-service-error.ts';

export const autoIdentityService = 'https://login.on.auto';

export interface ProtectedResource {
  readonly publicUrl: string;
  readonly authorizationServers: readonly string[];
}

export interface IdentityService {
  readonly resource: ProtectedResource;
  readonly personOf: (token: string, resourcePath: string) => Promise<Authentication>;
}

export interface SignInSettings {
  readonly issuer: string;
  readonly publicUrl: string;
}

function audiencesOf(publicUrl: string, resourcePath: string): readonly string[] {
  return [publicUrl, `${publicUrl}/`, ...(resourcePath === '' ? [] : [`${publicUrl}${resourcePath}`])];
}

export async function identityServiceOf(
  { issuer, publicUrl }: SignInSettings,
  requests: IssuerRequests = issuerRequestsOverTheNetwork,
): Promise<IdentityService> {
  const keys = await keysOfIssuer(issuer, requests);
  if (Result.isFailure(keys)) {
    throw new UnusableIdentityServiceError({
      message: `The identity service at ${issuer} cannot be used: ${keys.failure}`,
    });
  }
  return {
    resource: { publicUrl, authorizationServers: [issuer] },
    personOf: async (token, resourcePath) => {
      const expected = { issuer, audiences: audiencesOf(publicUrl, resourcePath), now: requests.now() };
      const verified = await verifiedPerson(token, keys.success, expected);
      return Result.isSuccess(verified) ? signedInPersonOf(verified.success) : { because: verified.failure };
    },
  };
}
