import { everyPermission, type CallerIdentity } from '@beonauto/operations';

import type { ApiKey } from './api-key.ts';

export interface Principal {
  readonly callerIn: (org: string) => CallerIdentity;
}

export const localDeveloper: Principal = {
  callerIn: (org) => ({ id: 'local', org, permissions: everyPermission, brains: '*' }),
};

export function principalOf({ id, org, permissions, brains }: ApiKey): Principal {
  const caller: CallerIdentity = { id, org, permissions, brains };
  return { callerIn: () => caller };
}
