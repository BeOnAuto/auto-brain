import type {
  ConnectionAdded,
  ConnectionBroken,
  ConnectionConnected,
  LinkIssued,
  RecordedConnectionEvent,
} from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';

export interface OpenLink {
  readonly token_sha256: string;
  readonly expires_at: string;
}

export interface KeptConnection {
  readonly connection: RecordedConnection;
  readonly link: OpenLink | undefined;
  readonly secretId: string | undefined;
}

export type Registry = ReadonlyMap<string, KeptConnection>;

export const initialRegistry: Registry = new Map();

function addedConnection({ data, context }: ConnectionAdded): KeptConnection {
  const { connection: id, name, kind, entry, credential } = data;
  return {
    connection: {
      id,
      name,
      kind,
      entry,
      credential,
      status: 'pending',
      added_by: context.by,
      added_at: context.at,
      connected_at: null,
      connected_by: null,
      broken: null,
    },
    link: undefined,
    secretId: undefined,
  };
}

function withLink(kept: KeptConnection, { data }: LinkIssued): KeptConnection {
  return { ...kept, link: { token_sha256: data.token_sha256, expires_at: data.expires_at } };
}

function connected(kept: KeptConnection, { data, context }: ConnectionConnected): KeptConnection {
  return {
    connection: {
      ...kept.connection,
      status: 'connected',
      connected_at: context.at,
      connected_by: context.by,
      broken: null,
    },
    link: undefined,
    secretId: data.secret_id,
  };
}

function broken(kept: KeptConnection, { data }: ConnectionBroken): KeptConnection {
  return { ...kept, connection: { ...kept.connection, status: 'broken', broken: data.reason } };
}

function removed(kept: KeptConnection): KeptConnection {
  return { ...kept, connection: { ...kept.connection, status: 'removed', broken: null }, link: undefined };
}

function evolvedConnection(
  kept: KeptConnection,
  event: Exclude<RecordedConnectionEvent, ConnectionAdded>,
): KeptConnection {
  if (event.type === 'connection_link_issued') {
    return withLink(kept, event);
  }
  if (event.type === 'connection_approved') {
    return kept;
  }
  if (event.type === 'connection_connected') {
    return connected(kept, event);
  }
  return event.type === 'connection_broken' ? broken(kept, event) : removed(kept);
}

function withConnection(registry: Registry, kept: KeptConnection): Registry {
  return new Map(registry).set(kept.connection.id, kept);
}

export function evolveRegistry(registry: Registry, event: RecordedConnectionEvent): Registry {
  if (event.type === 'connection_added') {
    return withConnection(registry, addedConnection(event));
  }
  const kept = registry.get(event.data.connection);
  return kept === undefined ? registry : withConnection(registry, evolvedConnection(kept, event));
}

export function newestFirst(registry: Registry): readonly KeptConnection[] {
  return [...registry.values()].toReversed();
}
