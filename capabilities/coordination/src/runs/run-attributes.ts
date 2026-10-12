import { CallerIdentitySchema, type CallerIdentity, type Permission } from '@beonauto/operations';
import { Option, Schema } from 'effect';

const fields = {
  org: Schema.String,
  run_id: Schema.String,
  definition: Schema.Struct({ name: Schema.String, version: Schema.Int }),
  depth: Schema.optionalKey(Schema.Int),
  call_depth: Schema.optionalKey(Schema.Int),
  called_by: Schema.optionalKey(Schema.Struct({ run_id: Schema.String, reference: Schema.String, run: Schema.Int })),
  trigger: Schema.optionalKey(
    Schema.Struct({ kind: Schema.Literals(['event', 'cron', 'every']), reference: Schema.String }),
  ),
  lineage: Schema.optionalKey(Schema.Struct({ start: Schema.String, correlation: Schema.String })),
};

const RunAttributesSchema = Schema.Struct({ ...fields, playbook: Schema.String, caller: CallerIdentitySchema });

const storedPermissions = Schema.Literals(['org:read', 'org:write', 'brain:read', 'brain:write']);

const StoredAttributesSchema = Schema.Struct({
  ...fields,
  brain: Schema.String,
  caller: Schema.Struct({
    id: CallerIdentitySchema.fields.id,
    org: CallerIdentitySchema.fields.org,
    permissions: Schema.Array(storedPermissions),
    brains: CallerIdentitySchema.fields.playbooks,
  }),
});

const permissionOf: Readonly<Record<typeof storedPermissions.Type, Permission>> = {
  'org:read': 'org:read',
  'org:write': 'org:write',
  'brain:read': 'playbook:read',
  'brain:write': 'playbook:write',
};

const storedPermissionOf: Readonly<Record<Permission, typeof storedPermissions.Type>> = {
  'org:read': 'org:read',
  'org:write': 'org:write',
  'playbook:read': 'brain:read',
  'playbook:write': 'brain:write',
};

export type RunAttributes = typeof RunAttributesSchema.Type;

const readAttributes = Schema.decodeUnknownOption(Schema.Union([RunAttributesSchema, StoredAttributesSchema]));

export function attributesOfRun(value: unknown): Option.Option<RunAttributes> {
  return Option.map(readAttributes(value), (attributes) => {
    if ('playbook' in attributes) return attributes;
    const { brain, caller: stored, ...rest } = attributes;
    const { brains, permissions, ...identity } = stored;
    const caller: CallerIdentity = {
      ...identity,
      playbooks: brains,
      permissions: permissions.map((p) => permissionOf[p]),
    };
    return { ...rest, playbook: brain, caller };
  });
}

export function storedAttributesOfRun({ playbook, caller, ...rest }: RunAttributes): Schema.JsonObject {
  const { playbooks, permissions, ...identity } = caller;
  return {
    ...rest,
    brain: playbook,
    caller: { ...identity, brains: playbooks, permissions: permissions.map((p) => storedPermissionOf[p]) },
  };
}
