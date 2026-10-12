import { allPermissions, type CallerIdentity } from '@on.auto/operations';

import type { ApiKey } from '../keys/api-key.ts';
import { localOrg } from './local-org.ts';

export interface Principal {
  readonly org: string;
  readonly callerIn: (org: string) => CallerIdentity;
}

export const localDeveloper: Principal = {
  org: localOrg,
  callerIn: (org) => ({ id: 'local', org, permissions: allPermissions, playbooks: '*' }),
};

export function principalOf({ id, org, permissions, playbooks }: ApiKey): Principal {
  const caller: CallerIdentity = { id, org, permissions, playbooks };
  return { org, callerIn: () => caller };
}
