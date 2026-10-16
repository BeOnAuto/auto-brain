import { Array as Arr, Effect, Option } from 'effect';

import type {
  ConnectionServer,
  ConnectionSettings,
  ConnectionSource,
  ConnectionUnready,
  OrgConnection,
} from '../org-servers/connection-source.ts';
import type { ServerSettings } from '../settings/server-settings.ts';
import { readToolServerSettings, type Environment } from '../settings/settings-reading.ts';

export interface FakeConnection {
  readonly id: string;
  readonly name: string;
  readonly entry: Readonly<Record<string, unknown>>;
  readonly environment?: Environment;
  readonly reaches?: ConnectionServer['reaches'];
}

type Standing =
  | { readonly status: 'connected' }
  | { readonly status: 'pending' }
  | { readonly status: 'broken'; readonly reason: string }
  | { readonly status: 'unreadable'; readonly reason: string }
  | { readonly status: 'not_allowed'; readonly rule: string };

interface Kept {
  readonly org: string;
  readonly connection: FakeConnection;
  readonly settings: ConnectionSettings;
}

export interface FakeConnections extends ConnectionSource {
  readonly connect: (org: string, connection: FakeConnection) => void;
  readonly pend: (org: string, connection: FakeConnection) => void;
  readonly breakOff: (id: string, reason: string) => void;
  readonly loseTheCredentialOf: (id: string, reason: string) => void;
  readonly disallow: (id: string, rule: string) => void;
  readonly remove: (id: string) => void;
  readonly credentialReads: () => number;
}

interface Held {
  readonly kept: Map<string, Kept>;
  readonly standings: Map<string, Standing>;
  readonly reads: Map<'credential', number>;
}

export function pendingWords(name: string): string {
  return `Nobody has approved the connection ${name} yet; the person who added it opens its link, or removes it and adds it again`;
}

function isConnectionSettings(settings: ServerSettings): settings is ConnectionSettings {
  return settings.type !== 'stdio';
}

function settingsOf(org: string, { name, entry, environment = {} }: FakeConnection): ConnectionSettings {
  const read = Effect.runSync(
    readToolServerSettings(
      { ...environment, TOOL_SERVERS: JSON.stringify({ [name]: { ...entry, org } }) },
      { modelProviders: [] },
    ),
  );
  return Option.getOrThrow(Arr.head(read.servers.filter((settings) => isConnectionSettings(settings))));
}

function unreadyOf(name: string, standing: Standing): ConnectionUnready | undefined {
  if (standing.status === 'pending') {
    return { because: 'connection_pending', detail: pendingWords(name) };
  }
  return standing.status === 'broken' ? { because: 'connection_broken', detail: standing.reason } : undefined;
}

const noRefusedAddress = new Map<string, string>();

function everyAddress(url: string): string | undefined {
  return noRefusedAddress.get(url);
}

function standingOf({ standings }: Held, id: string): Standing {
  return Option.getOrThrow(Option.fromNullishOr(standings.get(id)));
}

function readsOf({ reads }: Held): number {
  return Option.getOrThrow(Option.fromNullishOr(reads.get('credential')));
}

function preparedOf(held: Held, { connection, settings }: Kept): Effect.Effect<ConnectionServer, ConnectionUnready> {
  return Effect.suspend((): Effect.Effect<ConnectionServer, ConnectionUnready> => {
    held.reads.set('credential', readsOf(held) + 1);
    const standing = standingOf(held, connection.id);
    if (standing.status === 'unreadable') {
      held.standings.set(connection.id, { status: 'broken', reason: standing.reason });
      return Effect.fail({ because: 'connection_broken', detail: standing.reason });
    }
    return standing.status === 'not_allowed'
      ? Effect.fail({ because: 'connection_not_allowed', detail: standing.rule })
      : Effect.succeed({ settings, reaches: connection.reaches ?? everyAddress });
  });
}

function listedOf(held: Held, kept: Kept): OrgConnection {
  const { id, name } = kept.connection;
  const { type, orgs, playbooks, allowed, record_content, request_id } = kept.settings;
  const serving = { name, type, orgs, playbooks, allowed, record_content, request_id };
  const unready = unreadyOf(name, standingOf(held, id));
  return unready === undefined
    ? { id, serving, state: { status: 'connected', server: preparedOf(held, kept) } }
    : { id, serving, state: { status: 'unready', unready } };
}

export function fakeConnections(): FakeConnections {
  const held: Held = { kept: new Map(), standings: new Map(), reads: new Map([['credential', 0]]) };
  const keep = (org: string, connection: FakeConnection, standing: Standing): void => {
    held.kept.set(connection.id, { org, connection, settings: settingsOf(org, connection) });
    held.standings.set(connection.id, standing);
  };
  return {
    takesConnections: true,
    connectionsOf: (org) =>
      Effect.sync(() => [...held.kept.values()].filter((kept) => kept.org === org).map((kept) => listedOf(held, kept))),
    connect: (org, connection) => {
      keep(org, connection, { status: 'connected' });
    },
    pend: (org, connection) => {
      keep(org, connection, { status: 'pending' });
    },
    breakOff: (id, reason) => {
      held.standings.set(id, { status: 'broken', reason });
    },
    loseTheCredentialOf: (id, reason) => {
      held.standings.set(id, { status: 'unreadable', reason });
    },
    disallow: (id, rule) => {
      held.standings.set(id, { status: 'not_allowed', rule });
    },
    remove: (id) => {
      held.kept.delete(id);
    },
    credentialReads: () => readsOf(held),
  };
}
