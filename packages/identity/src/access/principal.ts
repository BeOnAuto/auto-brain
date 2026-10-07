import { allPermissions, requestTokenCallerOf, type CallerIdentity } from '@beonauto/operations';

import type { ApiKey } from '../keys/api-key.ts';
import { localOrg } from './local-org.ts';

export interface Principal {
  readonly org: string;
  readonly callerIn: (org: string) => CallerIdentity;
  readonly requestToken?: string;
}

export const localDeveloper: Principal = {
  org: localOrg,
  callerIn: (org) => ({ id: 'local', org, permissions: allPermissions, brains: '*' }),
};

export function principalOf({ id, org, permissions, brains }: ApiKey): Principal {
  const caller: CallerIdentity = { id, org, permissions, brains };
  return { org, callerIn: () => caller };
}

export function requestTokenHolderOf(requestToken: string): Principal {
  return { org: '', requestToken, callerIn: (org) => requestTokenCallerOf(org, requestToken) };
}
