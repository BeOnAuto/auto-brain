import { Context, Schema } from 'effect';

import { BrainAccessSchema, type BrainAccess } from './brain-access.ts';
import { OrgIdSchema } from './identifiers.ts';
import { PermissionSchema, type Permission } from './permission.ts';

export interface CallerIdentity {
  readonly id: string;
  readonly org: string;
  readonly permissions: readonly Permission[];
  readonly brains: BrainAccess;
  readonly requestToken?: string;
}

export const CallerIdentitySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  org: OrgIdSchema,
  permissions: Schema.Array(PermissionSchema),
  brains: BrainAccessSchema,
});

export const requestTokenRefused = 'The token does not answer this request';

export function requestTokenCallerOf(org: string, requestToken: string): CallerIdentity {
  return { id: 'request-token', org, permissions: [], brains: [], requestToken };
}

export function brainCallerOf({ org, brain }: { readonly org: string; readonly brain: string }): CallerIdentity {
  return { id: `brain:${brain}`, org, permissions: ['brain:read', 'brain:write'], brains: [brain] };
}

export class Caller extends Context.Service<Caller, CallerIdentity>()('@beonauto/operations/Caller') {}
