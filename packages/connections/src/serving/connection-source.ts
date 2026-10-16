import type { StreamReader, StreamWriter } from '@on.auto/operations';
import {
  checkedEntry,
  type ConnectionServer,
  type ConnectionServing,
  type ConnectionSettings,
  type ConnectionSource,
  type ConnectionUnready,
  type OrgConnection,
  type ServerSettings,
} from '@on.auto/tool-servers';
import { DateTime, Effect, Option, Result, type Redacted } from 'effect';

import type { SecretKeeping } from '../operations/connection-services.ts';
import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import { hostRefusalOf, policyRefusalOf } from '../policy/policy-rules.ts';
import { connectionsFold, connectionsStreamOfOrg, registryDecider } from '../registry/registry-decider.ts';
import { newestFirst, type KeptConnection } from '../registry/registry.ts';
import { placedCredential, type GivenValue } from './placed-credentials.ts';
import { servingWords } from './serving-words.ts';

export interface ServingServices {
  readonly registry: StreamReader & StreamWriter;
  readonly secrets: Pick<SecretKeeping, 'read'>;
  readonly policy: ConnectionPolicy;
  readonly variables: ReadonlyMap<string, Redacted.Redacted>;
  readonly providers: readonly string[];
}

interface Serving {
  readonly org: string;
  readonly kept: KeptConnection;
  readonly services: ServingServices;
}

type Given = Effect.Effect<GivenValue | undefined, ConnectionUnready>;

const theRuntime = 'runtime';

function notAllowed(detail: string): ConnectionUnready {
  return { because: 'connection_not_allowed', detail };
}

function servingOf(org: string, { name, kind, entry }: KeptConnection['connection']): ConnectionServing {
  return {
    name,
    type: kind,
    orgs: [org],
    playbooks: entry.playbooks ?? null,
    allowed: entry.allowed ?? null,
    record_content: entry.record_content ?? true,
    request_id: entry.request_id ?? null,
  };
}

function broken({ org, kept, services }: Serving, reason: string): Given {
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const breaking = { type: 'break', connection: kept.connection.id, reason, by: theRuntime, at } as const;
    yield* Effect.exit(services.registry.execute(connectionsStreamOfOrg(org), registryDecider, breaking));
    const unready: ConnectionUnready = { because: 'connection_broken', detail: reason };
    return yield* Effect.fail(unready);
  });
}

function keptSecretOf(serving: Serving): Given {
  const { kept, services } = serving;
  const { name } = kept.connection;
  const secretId = Option.getOrThrow(Option.fromNullishOr(kept.secretId));
  return services.secrets.read(secretId).pipe(
    Effect.matchEffect({
      onFailure: ({ detail }) => broken(serving, servingWords.unreadable(name, detail)),
      onSuccess: (value) =>
        value === undefined
          ? broken(serving, servingWords.gone(name))
          : Effect.succeed({ value, algorithm: kept.algorithm }),
    }),
  );
}

function referencedOf({ kept, services }: Serving): Given {
  const { credential, name } = kept.connection;
  const variable = Option.getOrThrow(Option.fromNullishOr(credential.variable));
  const value = services.variables.get(variable);
  return value === undefined
    ? Effect.fail(notAllowed(servingWords.unset(name, variable)))
    : Effect.succeed({ value, algorithm: undefined });
}

function givenOf(serving: Serving): Given {
  const { kind } = serving.kept.connection.credential;
  if (kind === 'none') {
    return Effect.undefined;
  }
  if (kind === 'authorization') {
    return Effect.fail(notAllowed(servingWords.authorization));
  }
  return kind === 'reference' ? referencedOf(serving) : keptSecretOf(serving);
}

function isConnectionSettings(settings: ServerSettings): settings is ConnectionSettings {
  return settings.type !== 'stdio';
}

function settingsOf({ org, kept, services }: Serving, given: GivenValue | undefined) {
  const { name, kind, entry, credential } = kept.connection;
  const { fields, secrets } = placedCredential(entry, credential, given);
  const checked = checkedEntry(
    name,
    { ...fields, type: kind, org },
    { providers: services.providers, directory: '.', secrets },
  );
  return Result.isFailure(checked)
    ? Effect.fail(
        notAllowed(
          servingWords.unchecked(
            name,
            checked.failure.map(({ detail }) => detail),
          ),
        ),
      )
    : Effect.succeed(Option.getOrThrow(Option.liftPredicate(checked.success, isConnectionSettings)));
}

function preparedServer(serving: Serving): Effect.Effect<ConnectionServer, ConnectionUnready> {
  const { policy } = serving.services;
  return Effect.gen(function* () {
    const refusal = policyRefusalOf(policy, serving.kept.connection);
    if (refusal !== undefined) {
      return yield* Effect.fail(notAllowed(refusal.detail));
    }
    const settings = yield* settingsOf(serving, yield* givenOf(serving));
    const reaches = (url: string): string | undefined =>
      hostRefusalOf(policy.allowedHosts, new URL(url).hostname)?.detail;
    return { settings, reaches };
  });
}

function orgConnectionOf(serving: Serving): OrgConnection {
  const { connection } = serving.kept;
  const { id, name, status } = connection;
  const serves = { id, serving: servingOf(serving.org, connection) };
  if (status === 'pending') {
    return {
      ...serves,
      state: { status: 'unready', unready: { because: 'connection_pending', detail: servingWords.pending(name) } },
    };
  }
  return status === 'broken'
    ? {
        ...serves,
        state: {
          status: 'unready',
          unready: { because: 'connection_broken', detail: Option.getOrThrow(Option.fromNullishOr(connection.broken)) },
        },
      }
    : { ...serves, state: { status: 'connected', server: preparedServer(serving) } };
}

export function makeConnectionSource(services: ServingServices): ConnectionSource {
  return {
    takesConnections: services.policy.peopleMayAdd,
    connectionsOf: (org) =>
      Effect.map(services.registry.load(connectionsStreamOfOrg(org), connectionsFold), ({ state }) =>
        newestFirst(state)
          .filter((kept) => kept.connection.status !== 'removed')
          .map((kept) => orgConnectionOf({ org, kept, services })),
      ),
  };
}
