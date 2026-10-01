import { Context, Schema } from 'effect';

import { BrainAccessSchema, type BrainAccess } from './brain-access.ts';
import { OrgIdSchema } from './identifiers.ts';
import { PermissionSchema, type Permission } from './permission.ts';

export interface CallerIdentity {
  readonly id: string;
  readonly org: string;
  readonly permissions: readonly Permission[];
  readonly brains: BrainAccess;
}

export const CallerIdentitySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  org: OrgIdSchema,
  permissions: Schema.Array(PermissionSchema),
  brains: BrainAccessSchema,
});

export class Caller extends Context.Service<Caller, CallerIdentity>()('@beonauto/operations/Caller') {}
