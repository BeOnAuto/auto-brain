import { servesOrg } from '@on.auto/config';
import { Effect, Schema } from 'effect';

import { ToolNotOffered } from '../access/tool-not-offered.ts';
import { ToolServerFailed } from '../access/tool-server-failed.ts';
import type { ServerLink } from '../connections/server-links.ts';
import type { UnavailableBecause } from '../listing/tool-server.ts';
import type { LinkedServerSettings } from '../openapi/described-api.ts';
import type { ConnectionUnready, UnreadyBecause } from './connection-source.ts';

export type Served = Pick<
  LinkedServerSettings,
  'name' | 'type' | 'orgs' | 'playbooks' | 'allowed' | 'record_content' | 'request_id' | 'connection'
>;

export interface Unusable {
  readonly because: UnavailableBecause;
  readonly detail: string;
}

export type Linked = { readonly link: ServerLink } | { readonly refused: Unusable };

export interface OrgServer {
  readonly settings: Served;
  readonly checked: () => Promise<readonly ConnectionUnready[]>;
  readonly linked: () => Promise<Linked>;
}

const UnreadyBecauseSchema = Schema.Literals(['connection_pending', 'connection_broken', 'connection_not_allowed']);

export const isUnready: (because: UnavailableBecause) => because is UnreadyBecause = Schema.is(UnreadyBecauseSchema);

function refusalOf({ because, detail }: Unusable): ToolNotOffered | ToolServerFailed {
  return isUnready(because) ? new ToolNotOffered({ because, detail }) : new ToolServerFailed({ because, detail });
}

export function linksOf(
  linked: readonly Linked[],
): Effect.Effect<readonly ServerLink[], ToolNotOffered | ToolServerFailed> {
  const links: ServerLink[] = [];
  for (const each of linked) {
    if ('refused' in each) {
      return Effect.fail(refusalOf(each.refused));
    }
    links.push(each.link);
  }
  return Effect.succeed(links);
}

export function unreadyServer(settings: Served, unready: ConnectionUnready): OrgServer {
  return {
    settings,
    checked: () => Promise.resolve([unready]),
    linked: () => Promise.resolve({ refused: unready }),
  };
}

function takenByTheFile(name: string): ConnectionUnready {
  return {
    because: 'connection_not_allowed',
    detail: `The runtime's configuration sets up a tool server named ${name}, so the connection ${name} is not used; remove it and add it again under another name`,
  };
}

export function withTheFileFirst(files: readonly OrgServer[], connections: readonly OrgServer[]): readonly OrgServer[] {
  const fileNames = new Set(files.map(({ settings }) => settings.name));
  const shadowed = connections.map((server) =>
    fileNames.has(server.settings.name) ? unreadyServer(server.settings, takenByTheFile(server.settings.name)) : server,
  );
  return [...files, ...shadowed];
}

function isOfTheFile({ settings }: OrgServer): boolean {
  return settings.connection === null;
}

export function namedIn(org: string, servers: readonly OrgServer[]): ReadonlyMap<string, OrgServer> {
  const files = servers.filter((server) => isOfTheFile(server));
  const servingTheOrg = files.filter(({ settings }) => servesOrg(settings, org));
  const connections = servers.filter((server) => !isOfTheFile(server));
  const named = new Map<string, OrgServer>();
  for (const server of [...servingTheOrg, ...connections, ...files]) {
    if (!named.has(server.settings.name)) {
      named.set(server.settings.name, server);
    }
  }
  return named;
}

function inOrder(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}

export function byNameFileFirst(first: OrgServer, second: OrgServer): number {
  const byName = inOrder(first.settings.name, second.settings.name);
  return byName === 0 ? Number(isOfTheFile(second)) - Number(isOfTheFile(first)) : byName;
}
