import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PermissionSchema, everyPermission, permissionFor, type Kind, type Permission, type Scope } from './index.ts';

const derived: ReadonlyArray<readonly [Kind, Scope, Permission]> = [
  ['query', 'org', 'org:read'],
  ['command', 'org', 'org:write'],
  ['query', 'brain', 'brain:read'],
  ['command', 'brain', 'brain:write'],
];

describe('permissions', () => {
  it('are four, one per scope and access', () => {
    expect(everyPermission).toEqual(['org:read', 'org:write', 'brain:read', 'brain:write']);
  });

  it.each(derived)('make a %s at %s scope need %s', (kind, scope, permission) => {
    expect(permissionFor(kind, scope)).toBe(permission);
  });

  it('decode only the four names', () => {
    const isPermission = Schema.is(PermissionSchema);

    expect(everyPermission.every((permission) => isPermission(permission))).toBe(true);
    expect(isPermission('org:admin')).toBe(false);
  });
});
