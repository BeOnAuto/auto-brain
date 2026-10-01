import { Schema } from 'effect';

import type { Kind, Scope } from './scope.ts';

export const PermissionSchema = Schema.Literals(['org:read', 'org:write', 'brain:read', 'brain:write']);

export type Permission = typeof PermissionSchema.Type;

export const everyPermission: readonly Permission[] = PermissionSchema.literals;

const accessByKind: Readonly<Record<Kind, 'read' | 'write'>> = { query: 'read', command: 'write' };

export function permissionFor(kind: Kind, scope: Scope): Permission {
  return `${scope}:${accessByKind[kind]}`;
}
