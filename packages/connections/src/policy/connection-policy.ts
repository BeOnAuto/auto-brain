import { decodedJsonSetting, type SettingProblem } from '@on.auto/config';
import { Data, Effect, Result, Schema } from 'effect';

import { CredentialKindSchema, type CredentialKind } from '../registry/credential.ts';

const connectionsSetting = 'CONNECTIONS';

const hostLabel = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';

const HostPatternSchema = Schema.String.check(
  Schema.isPattern(new RegExp(`^(?:\\*\\.)?${hostLabel}(?:\\.${hostLabel})*$`, 'u'), {
    message: 'Expected a host, such as crm.example.com, or a host after *. for every host under it',
  }),
);

export const ConnectionPolicySchema = Schema.Struct({
  people_may_add: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'Whether people may add connections through their agents; true when left out',
    }),
  ),
  allowed_hosts: Schema.optionalKey(
    Schema.Array(HostPatternSchema).annotate({
      description:
        'The hosts a connection may reach, each a host or *. and a host for every host under it; every host when left out',
    }),
  ),
  credential_kinds: Schema.optionalKey(
    Schema.Array(CredentialKindSchema).annotate({
      description:
        'The kinds of credential a connection may take, of none, reference, secret, client_credentials and authorization; every kind when left out',
    }),
  ),
}).annotate({
  description:
    'What people may add as connections through their agents: tool servers of an org, which every playbook of the org may use. CONNECTIONS wins over it',
});

export type ConnectionPolicyFields = typeof ConnectionPolicySchema.Type;

export interface ConnectionPolicy {
  readonly peopleMayAdd: boolean;
  readonly allowedHosts: readonly string[] | null;
  readonly credentialKinds: readonly CredentialKind[] | null;
}

export class ConnectionPolicyInvalid extends Data.TaggedError('connection_policy_invalid')<{
  readonly message: string;
  readonly problems: readonly SettingProblem[];
}> {}

export function connectionPolicyOf({
  people_may_add: peopleMayAdd = true,
  allowed_hosts: allowedHosts,
  credential_kinds: credentialKinds,
}: ConnectionPolicyFields): ConnectionPolicy {
  return { peopleMayAdd, allowedHosts: allowedHosts ?? null, credentialKinds: credentialKinds ?? null };
}

function invalid(problems: readonly SettingProblem[]): ConnectionPolicyInvalid {
  const listed = problems.map(({ setting, detail }) => `${setting}: ${detail}`).join('; ');
  return new ConnectionPolicyInvalid({ message: `The connection settings are invalid. ${listed}`, problems });
}

export function readConnectionPolicy(
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<ConnectionPolicy, ConnectionPolicyInvalid> {
  const text = environment[connectionsSetting];
  if (text === undefined || text === '') {
    return Effect.succeed(connectionPolicyOf({}));
  }
  return Result.match(decodedJsonSetting(connectionsSetting, text, ConnectionPolicySchema), {
    onSuccess: (fields) => Effect.succeed(connectionPolicyOf(fields)),
    onFailure: (problems) => Effect.fail(invalid(problems)),
  });
}
