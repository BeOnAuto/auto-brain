import type { IdentityService, ProtectedResource } from '../identity-service/identity-service.ts';
import { keyPrefix, type ApiKey } from '../keys/api-key.ts';
import { verifyKey } from '../keys/verify-key.ts';
import { listensOnlyOnLoopback } from './loopback.ts';
import { localDeveloper, principalOf, unexplained, type Authentication } from './principal.ts';
import { ReachableWithoutCredentialsError } from './reachable-without-credentials-error.ts';

export type AccessMode = 'local' | 'credentials' | 'closed';

export interface Authenticator {
  readonly mode: AccessMode;
  readonly resource: ProtectedResource | undefined;
  readonly authenticate: (
    presented: string | undefined,
    resourcePath: string,
    requestOrigin?: string,
  ) => Promise<Authentication>;
}

export interface AccessSettings {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly identityService?: IdentityService | undefined;
}

function keyHolderOf(keys: readonly ApiKey[], presented: string | undefined): Authentication {
  const key = presented === undefined ? undefined : verifyKey(keys, presented);
  return key === undefined ? unexplained : principalOf(key);
}

function credentialHolderOf(keys: readonly ApiKey[], identityService?: IdentityService): Authenticator['authenticate'] {
  return (presented, resourcePath, requestOrigin) =>
    presented !== undefined && identityService !== undefined && !presented.startsWith(keyPrefix)
      ? identityService.personOf(presented, resourcePath, requestOrigin)
      : Promise.resolve(keyHolderOf(keys, presented));
}

const localAccess: Authenticator = {
  mode: 'local',
  resource: undefined,
  authenticate: () => Promise.resolve(localDeveloper),
};

const closedAccess: Authenticator = { mode: 'closed', resource: undefined, authenticate: credentialHolderOf([]) };

function credentialAccessOf(keys: readonly ApiKey[], identityService: IdentityService | undefined): Authenticator {
  if (keys.length === 0 && identityService === undefined) {
    return closedAccess;
  }
  return {
    mode: 'credentials',
    resource: identityService?.resource,
    authenticate: credentialHolderOf(keys, identityService),
  };
}

export function authenticatorFor({ host, apiKeys, identityService }: AccessSettings): Authenticator {
  if (apiKeys !== undefined || identityService !== undefined) {
    return credentialAccessOf(apiKeys ?? [], identityService);
  }
  if (!listensOnlyOnLoopback(host)) {
    throw new ReachableWithoutCredentialsError({
      message: `A server reachable beyond this computer needs PUBLIC_URL, to sign people in, or API_KEYS, and this one listens on HOST ${host}`,
    });
  }
  return localAccess;
}
