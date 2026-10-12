import { Context, Schema } from 'effect';

import { PlaybookAccessSchema, type PlaybookAccess } from './brain-access.ts';
import { OrgIdSchema } from './identifiers.ts';
import { PermissionSchema, type Permission } from './permission.ts';

export interface CallerIdentity {
  readonly id: string;
  readonly org: string;
  readonly permissions: readonly Permission[];
  readonly playbooks: PlaybookAccess;
}

export const CallerIdentitySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  org: OrgIdSchema,
  permissions: Schema.Array(PermissionSchema),
  playbooks: PlaybookAccessSchema,
});

export function playbookCallerOf({
  org,
  playbook,
}: {
  readonly org: string;
  readonly playbook: string;
}): CallerIdentity {
  return { id: `brain:${playbook}`, org, permissions: ['playbook:read', 'playbook:write'], playbooks: [playbook] };
}

export class Caller extends Context.Service<Caller, CallerIdentity>()('@beonauto/operations/Caller') {}
