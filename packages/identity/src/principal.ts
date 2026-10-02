import { allPermissions, type CallerIdentity } from '@beonauto/operations';

import type { ApiKey } from './api-key.ts';

export interface Principal {
  readonly org: string;
  readonly callerIn: (org: string) => CallerIdentity;
}

const localOrg = 'local';

export const localDeveloper: Principal = {
  org: localOrg,
  callerIn: (org) => ({ id: 'local', org, permissions: allPermissions, brains: '*' }),
};

export function principalOf({ id, org, permissions, brains }: ApiKey): Principal {
  const caller: CallerIdentity = { id, org, permissions, brains };
  return { org, callerIn: () => caller };
}
