import { allPermissions, type CallerIdentity } from '@on.auto/operations';

import type { ApiKey } from '../keys/api-key.ts';
import { localDeveloperId, localOrg } from './local-org.ts';

export interface Principal {
  readonly org: string | undefined;
  readonly callerIn: (org: string) => CallerIdentity | undefined;
}

export const localDeveloper: Principal = {
  org: localOrg,
  callerIn: (org) => ({ id: localDeveloperId, org, permissions: allPermissions, playbooks: '*' }),
};

export function principalOf({ id, org, permissions, playbooks }: ApiKey): Principal {
  const caller: CallerIdentity = { id, org, permissions, playbooks };
  return { org, callerIn: (asked) => (asked === org ? caller : undefined) };
}
