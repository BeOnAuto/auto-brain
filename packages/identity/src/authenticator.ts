import type { ApiKey } from './api-key.ts';
import { InvalidLocalModeError } from './invalid-local-mode-error.ts';
import { listensOnlyOnLoopback } from './loopback.ts';
import { localDeveloper, principalOf, type Principal } from './principal.ts';
import { verifyKey } from './verify-key.ts';

export type AccessMode = 'local' | 'keys' | 'closed';

export interface Authenticator {
  readonly mode: AccessMode;
  readonly authenticate: (presentedKey?: string) => Principal | undefined;
}

export interface AccessSettings {
  readonly host: string;
  readonly apiKeys: readonly ApiKey[] | undefined;
  readonly localMode: boolean;
}

function keyHolderOf(keys: readonly ApiKey[], presentedKey: string | undefined): Principal | undefined {
  const key = presentedKey === undefined ? undefined : verifyKey(keys, presentedKey);
  return key === undefined ? undefined : principalOf(key);
}

const localAccess: Authenticator = { mode: 'local', authenticate: () => localDeveloper };

const closedAccess: Authenticator = { mode: 'closed', authenticate: (presentedKey) => keyHolderOf([], presentedKey) };

export function authenticatorFor({ host, apiKeys, localMode }: AccessSettings): Authenticator {
  if (localMode && !listensOnlyOnLoopback(host)) {
    throw new InvalidLocalModeError({
      message: `LOCAL_MODE is on, but HOST ${host} is not a loopback address; local mode trusts every request, so it runs only on localhost, 127.0.0.1 or ::1`,
    });
  }
  if (apiKeys !== undefined) {
    return { mode: 'keys', authenticate: (presentedKey) => keyHolderOf(apiKeys, presentedKey) };
  }
  return localMode ? localAccess : closedAccess;
}
