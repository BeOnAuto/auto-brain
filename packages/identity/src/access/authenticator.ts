import type { IdentityService, ProtectedResource } from '../identity-service/identity-service.ts';
import { keyPrefix, type ApiKey } from '../keys/api-key.ts';
import { verifyKey } from '../keys/verify-key.ts';
import { InvalidLocalModeError } from './invalid-local-mode-error.ts';
import { listensOnlyOnLoopback } from './loopback.ts';
import { localDeveloper, principalOf, unexplained, type Authentication } from './principal.ts';

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
  readonly localMode: boolean;
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

export function authenticatorFor({ host, apiKeys, localMode, identityService }: AccessSettings): Authenticator {
  if (localMode && !listensOnlyOnLoopback(host)) {
    throw new InvalidLocalModeError({
      message: `LOCAL_MODE is on, but HOST ${host} is not a loopback address; local mode trusts every request, so it runs only on localhost, 127.0.0.1 or ::1`,
    });
  }
  const keys = apiKeys ?? [];
  if (keys.length > 0 || identityService !== undefined) {
    return {
      mode: 'credentials',
      resource: identityService?.resource,
      authenticate: credentialHolderOf(keys, identityService),
    };
  }
  return localMode && apiKeys === undefined ? localAccess : closedAccess;
}
