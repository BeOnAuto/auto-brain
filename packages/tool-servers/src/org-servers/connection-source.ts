import { Effect } from 'effect';

import type { McpServerSettings, OpenApiServerSettings } from '../settings/server-settings.ts';

export type ConnectionSettings = McpServerSettings | OpenApiServerSettings;

export type ConnectionServing = Pick<
  ConnectionSettings,
  'name' | 'type' | 'orgs' | 'playbooks' | 'allowed' | 'record_content' | 'request_id'
>;

export type UnreadyBecause = 'connection_pending' | 'connection_broken' | 'connection_not_allowed';

export interface ConnectionUnready {
  readonly because: UnreadyBecause;
  readonly detail: string;
}

export interface ConnectionServer {
  readonly settings: ConnectionSettings;
  readonly reaches: (url: string) => string | undefined;
}

export type ConnectionState =
  | { readonly status: 'connected'; readonly server: Effect.Effect<ConnectionServer, ConnectionUnready> }
  | { readonly status: 'unready'; readonly unready: ConnectionUnready };

export interface OrgConnection {
  readonly id: string;
  readonly serving: ConnectionServing;
  readonly state: ConnectionState;
}

export interface ConnectionSource {
  readonly takesConnections: boolean;
  readonly connectionsOf: (org: string) => Effect.Effect<readonly OrgConnection[]>;
}

export const noConnections: ConnectionSource = {
  takesConnections: false,
  connectionsOf: () => Effect.succeed([]),
};
