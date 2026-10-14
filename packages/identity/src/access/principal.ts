import { allPermissions, type CallerIdentity, type Permission } from '@on.auto/operations';

import type { ApiKey } from '../keys/api-key.ts';
import { localDeveloperId, localOrg } from './local-org.ts';

export interface Principal {
  readonly own: CallerIdentity;
  readonly callerIn: (org: string) => CallerIdentity | undefined;
}

export interface Refusal {
  readonly because: string | undefined;
}

export type Authentication = Principal | Refusal;

export interface VerifiedPerson {
  readonly subject: string;
  readonly org: string;
  readonly permissions: readonly Permission[];
}

export function isRefusal(authentication: Authentication): authentication is Refusal {
  return 'because' in authentication;
}

export const unexplained: Refusal = { because: undefined };

function developerIn(org: string): CallerIdentity {
  return { id: localDeveloperId, org, permissions: allPermissions, playbooks: '*' };
}

export const localDeveloper: Principal = { own: developerIn(localOrg), callerIn: developerIn };

function principalOfCaller(caller: CallerIdentity): Principal {
  return { own: caller, callerIn: (asked) => (asked === caller.org ? caller : undefined) };
}

export function principalOf({ id, org, permissions, playbooks }: ApiKey): Principal {
  return principalOfCaller({ id, org, permissions, playbooks });
}

export function signedInPersonOf({ subject, org, permissions }: VerifiedPerson): Principal {
  return principalOfCaller({ id: `person:${subject}`, org, permissions, playbooks: '*' });
}
